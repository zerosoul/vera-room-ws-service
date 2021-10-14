require("dotenv").config();
const http = require("http");
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const socketIo = require("socket.io");
const { ManagementClient } = require("authing-js-sdk");
const { arrayChunks } = require("./utils");
const {
  gRequest,
  QUERY_ROOM_LIST,
  WINDOW_LIST,
  UPDATE_WIN_TITLE,
  QUERY_WINDOW
} = require("./graphqlClient");
const { initVeraSocket } = require("./ws.vera");
const { initWebrowseSocket } = require("./ws.webrowse");
const { initZoomWebrowseSocket } = require("./ws.zoom.webrowse");
const { Rooms } = require("./Room");
const { Windows } = require("./Window");

const managementClient = new ManagementClient({
  userPoolId: "6034a31382f5d09e3b5a15fa",
  secret: process.env.AUTHING_SECRET,
});
const app = express();
app.use(cors());
app.use(bodyParser.json());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  upgradeTimeout: 40000,
  pingTimeout: 30000
});

const PORT = 4000;

io.on("connection", async (socket) => {
  console.log(`${socket.id} connected`);
  // Join a room
  const {
    type = "VERA", ...rest
  } = socket.handshake.query || {};
  switch (type) {
    case "VERA": {
      const {
        roomId, temp = false, link, peerId, ...userInfo
      } = rest;
      initVeraSocket(io, socket, { roomId, temp, link, peerId, userInfo });
    }
      break;
    case "WEBROWSE": {
      const {
        roomId, winId, temp = false, title = "", invited, ...userInfo
      } = rest;
      initWebrowseSocket(io, socket, { roomId, invited, winId, temp, title, userInfo });
    }
      break;
    case "ZOOM_WEBROWSE": {
      const {
        roomId
      } = rest;
      initZoomWebrowseSocket(io, socket, { roomId });
    }
      break;
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
// APIs
// app.get("/rooms/:roomId/users", (req, res) => {
//   const users = getUsersInRoom(req.params.roomId);
//   return res.json({ users });
// });
app.get("/zoom/user/:uid", async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.json(null);
  let room_id = null;
  console.log("get zoom id with uid");
  Object.entries(Windows).forEach(([wid, win]) => {
    if (!win) return;
    console.log("get zoom id with uid:", wid, win.activeUsers);
    let us = win.activeUsers;
    if (us.findIndex((u) => u.uid == uid) > -1) {
      room_id = wid;
    }
  });
  return res.json({
    room_id
  });
});
app.get("/webrowse/user/active/:rid", async (req, res) => {
  const { rid } = req.params;
  if (!rid) return res.json(null);
  const room = Rooms[rid];
  if (!room) {
    return res.json({
      users: []
    });
  }
  return res.json({
    users: room.activeUsers
  });
});
// 
app.get("/webrowse/window/list/:rid", async (req, res) => {
  const { rid } = req.params;
  if (!rid) return res.json(null);
  const result = await gRequest(WINDOW_LIST, { room: rid });
  const windows = result?.portal_window;
  return res.json({
    windows
  });
});
app.post("/webrowse/window/title", async (req, res) => {
  console.log(req.body);
  const { id, title } = req.body;
  if (!id) return res.json(null);
  const result = await gRequest(UPDATE_WIN_TITLE, { id, title });
  return res.json({
    result
  });
});
app.get("/webrowse/window/:wid", async (req, res) => {
  const { wid } = req.params;
  if (!wid) return res.json(null);
  try {

    const result = await gRequest(QUERY_WINDOW, { id: wid });
    const window = result?.portal_window;
    return res.json({
      window
    });
  } catch (error) {
    return res.json({
      window: null
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
  const users = rooms.filter((r) => {
    return (r.host == username) || (r.members && r.members.some((m) => m.username == username));
  }
  ).map((room) => room.members).flat().filter((m) => {
    if (!m.id || m.username == username) return false;
    const duplicate = seen.has(m.id);
    seen.add(m.id);
    return !duplicate;
  });
  let udfs = {};
  try {
    let userIds = users.map((u) => u.uid);
    let chunks = arrayChunks(userIds, 10);
    let results = await Promise.all(chunks.map((ids) => {
      return managementClient.users.getUdfValueBatch(
        ids
      );
    }));
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

