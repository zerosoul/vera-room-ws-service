require("dotenv").config();
const http = require("http");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const socketIo = require("socket.io");
const { ManagementClient } = require("authing-js-sdk");
const { arrayChunks } = require("./utils");
const {
  gRequest,
  UPSERT_USER,
  UPDATE_USER_BY_AID,
  GET_INVITE_BY_RAND,
  REMOVE_WINDOW,
  QUERY_ROOM_LIST,
  WINDOW_LIST,
  QUERY_WINDOW,
  NEW_WINDOW,
  INSERT_TABS,
} = require("./graphqlClient");
const { initVeraSocket } = require("./ws.vera");
const { initWebrowseSocket } = require("./ws.webrowse");
const { initZoomWebrowseSocket } = require("./ws.zoom.webrowse");
const { Rooms } = require("./Room");
const { Windows } = require("./Window");
const { default: axios } = require("axios");

const managementClient = new ManagementClient({
  userPoolId: "6034a31382f5d09e3b5a15fa",
  secret: process.env.AUTHING_SECRET,
});
const app = express();
app.use(cors());
app.use(
  bodyParser.json({
    // Because Stripe needs the raw body, we compute it but only when hitting the Stripe callback URL.
    verify: function (req, res, buf) {
      var url = req.originalUrl;
      if (url.startsWith("/stripe/webhook")) {
        req.rawBody = buf.toString();
      }
    },
  })
);
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  upgradeTimeout: 40000,
  pingTimeout: 25000,
  pingInterval: 5000,
});

const PORT = 4000;

io.on("connection", async (socket) => {
  console.log(`${socket.id} connected`);
  // Join a room
  const { type = "VERA", ...rest } = socket.handshake.query || {};
  switch (type) {
    case "VERA":
      {
        const { roomId, temp = false, link, peerId, ...userInfo } = rest;
        initVeraSocket(io, socket, { roomId, temp, link, peerId, userInfo });
      }
      break;
    case "WEBROWSE":
      {
        const {
          roomId,
          winId,
          temp = false,
          title = "",
          invited,
          ...userInfo
        } = rest;
        initWebrowseSocket(io, socket, {
          roomId,
          invited,
          winId,
          temp,
          title,
          userInfo,
        });
      }
      break;
    case "ZOOM_WEBROWSE":
      {
        const { roomId, winId } = rest;
        initZoomWebrowseSocket(io, socket, { roomId, winId });
      }
      break;
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
// APIs
app.post("/authing/webhook", async (req, res) => {
  // const sig = req.headers["x-authing-webhook-secret"];
  // console.log("authing sig", sig);
  // if (!sig) {
  //   res.status(401).send();
  //   return;
  // }
  const { eventName, data } = req.body;
  switch (eventName) {
    case "login":
    case "register":
    case "user:updated":
      {
        const { id, username, photo, nickname, email } =
          eventName == "user:updated" ? data.user : data;
        const result = await gRequest(UPSERT_USER, {
          objects: {
            aid: id,
            username: username,
            email,
            nickname,
            avatar: photo,
          },
        });
        console.log("authing webhook resp", result);
      }
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${eventName}`);
  }
  res.send();
});
app.get("/stripe/portal/:customer", async (req, res) => {
  const { customer } = req.params;
  const ctm = await stripe.customers.retrieve(customer, {
    expand: ["subscriptions"],
  });
  const session = await stripe.billingPortal.sessions.create({
    customer,
    return_url: "https://webrow.se",
  });
  res.send({
    customer: ctm,
    session,
  });
});
app.post("/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  console.log("stripe sig", sig, req.rawBody);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.log(err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  console.log("stripe event", event.type);
  switch (event.type) {
    case "payment_intent.succeeded":
      {
        const { customer } = event.data.object;
        console.log("event data", customer);
        if (customer) {
          const c = await stripe.customers.retrieve(customer);
          const { aid } = c.metadata;
          if (aid) {
            const result = await gRequest(UPDATE_USER_BY_AID, {
              aid,
              customer,
            });
            console.log("stripe payment succeeded receipt_email", result);
          }
        }
        // Then define and call a function to handle the event payment_intent.succeeded
      }
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  res.send();
});

app.post("/subscription/create", async (req, res) => {
  const { user, priceId } = req.body;
  const { email, username, id } = user || {};
  const customer = await stripe.customers.create({
    email,
    metadata: {
      aid: id,
      username,
    },
  });
  // Create new Checkout Session for the order
  // Other optional params include:
  // [billing_address_collection] - to display billing address details on the page
  // [customer] - if you have an existing Stripe Customer ID
  // [customer_email] - lets you prefill the email input in the form
  // [automatic_tax] - to automatically calculate sales tax, VAT and GST in the checkout page
  // For full details see https://stripe.com/docs/api/checkout/sessions/create
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: customer.id,
      // customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
      success_url:
        "https://webrow.se/payment_success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://webrow.se/payment_canceled",
      // automatic_tax: { enabled: true }
    });
    res.send({
      session_url: session.url,
    });
  } catch (e) {
    res.status(400);
    return res.send({
      error: {
        message: e.message,
      },
    });
  }
});
// voce 第三方登录，拿token
app.get("/voce/oauth/:uid/:uname", async (req, res) => {
  const { uid, uname } = req.params;
  if (!uid || !uname) return res.json(null);
  try {
    const resp = await axios.post(
      "https://dev.voce.chat/api/token/create_third_party_key",
      { userid: uid, username: uname },
      {
        headers: {
          "Content-Type": "application/json",
          "X-SECRET": process.env.VOCE_SECRET,
        },
      }
    );
    console.log("voce", resp.data);
    return res.json({
      link: `https://privoce.voce.chat/#/oauth/${resp.data}`,
      token: resp.data,
    });
  } catch (error) {
    console.log("voce err", error);
    return res.json(null);
  }
});
app.get("/invite/:rand", async (req, res) => {
  const { rand } = req.params;
  if (!rand) return res.json(null);
  const result = await gRequest(GET_INVITE_BY_RAND, { rand });
  const [obj = null] = result?.portal_invite || [];
  if (obj) {
    const { data = "" } = obj;
    const [roomId, winId] = data.split("|");
    const result = await gRequest(QUERY_WINDOW, { id: winId });
    const win = Windows[winId];
    return res.json({
      roomId,
      winId,
      win: result?.portal_window[0],
      activeUsers: win?.activeUsers || [],
    });
  } else {
    return res.json(null);
  }
});
app.get("/zoom/user/:uid", async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.json(null);
  let roomId = null;
  let winId = null;
  console.log("get zoom id with uid");
  Object.entries(Windows).forEach(([wid, win]) => {
    if (!win) return;
    console.log("get zoom id with uid:", wid, win.activeUsers);
    let us = win.activeUsers;
    if (us.findIndex((u) => u.uid == uid) > -1) {
      roomId = win.roomId;
      winId = wid;
    }
  });
  return res.json({
    roomId,
    winId,
  });
});
app.get("/webrowse/user/active/:rid", async (req, res) => {
  const { rid } = req.params;
  if (!rid) return res.json(null);
  const room = Rooms[rid];
  if (!room) {
    return res.json({
      users: [],
    });
  }
  return res.json({
    users: room.activeUsers,
  });
});
// get active users in window
app.get("/webrowse/user/active/window/:wid", async (req, res) => {
  const { wid } = req.params;
  if (!wid) return res.json(null);
  const win = Windows[wid];
  if (!win) {
    return res.json({
      users: [],
    });
  }
  return res.json({
    users: win.activeUsers,
  });
});
//
app.get("/webrowse/window/list/:rid", async (req, res) => {
  const { rid } = req.params;
  if (!rid) return res.json(null);
  const result = await gRequest(WINDOW_LIST, { room: rid });
  const windows = result?.portal_window;
  return res.json({
    windows,
  });
});
app.get("/webrowse/window/:wid", async (req, res) => {
  const { wid } = req.params;
  if (!wid) return res.json(null);
  try {
    const result = await gRequest(QUERY_WINDOW, { id: wid });
    const window = result?.portal_window;
    return res.json({
      window,
    });
  } catch (error) {
    return res.json({
      window: null,
    });
  }
});
app.delete("/webrowse/window/:wid", async (req, res) => {
  console.log("start delete window", req.params);
  const { wid } = req.params;
  if (!wid) return res.json(null);
  try {
    const result = await gRequest(REMOVE_WINDOW, { id: wid });
    console.log("remove return", result);
    const id = result?.delete_portal_window?.returning[0]?.id;
    return res.json({
      id,
    });
  } catch (error) {
    console.log("remove window error", error);
    return res.json({
      id: null,
    });
  }
});
app.post("/webrowse/window", async (req, res) => {
  const { title, tabs } = req.body;
  if (!title) return res.json(null);
  try {
    const result = await gRequest(NEW_WINDOW, { room: "workspace", title });
    // 创建新window成功
    console.log("new window", result);
    if (result.insert_portal_window?.returning[0]?.id) {
      const id = result.insert_portal_window?.returning[0]?.id;
      gRequest(INSERT_TABS, {
        tabs: tabs.map((t) => {
          return { ...t, window: id };
        }),
      });
      return res.json({
        id: result.insert_portal_window?.returning[0]?.id,
      });
    }
  } catch (error) {
    console.log({ error });
    return res.json({
      id: null,
    });
  }
});
app.get("/members/authing/:username", async (req, res) => {
  console.log("rrrr");
  const { username } = req.params;
  if (!username) return res.json(null);
  const result = await gRequest(QUERY_ROOM_LIST, {});
  const rooms = result?.portal_room;
  const seen = new Set();
  const users = rooms
    .filter((r) => {
      return (
        r.host == username ||
        (r.members && r.members.some((m) => m.username == username))
      );
    })
    .map((room) => room.members)
    .flat()
    .filter((m) => {
      if (!m.id || m.username == username) return false;
      const duplicate = seen.has(m.id);
      seen.add(m.id);
      return !duplicate;
    });
  let udfs = {};
  try {
    let userIds = users.map((u) => u.uid);
    let chunks = arrayChunks(userIds, 10);
    let results = await Promise.all(
      chunks.map((ids) => {
        return managementClient.users.getUdfValueBatch(ids);
      })
    );
    // udfs = await managementClient.users.getUdfValueBatch(
    //   users.map((u) => u.uid),
    // );
    udfs = Object.assign({}, ...results);
    console.log({ chunks, results });
  } catch (error) {
    console.log(error);
  }
  console.log({ result, users });
  return res.json({
    data: users.map((u) => ({ ...u, traceId: udfs[u.uid].notification || "" })),
  });
});
