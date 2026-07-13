require("dotenv").config();
const http = require("http");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const bodyParser = require("body-parser");
const express = require("express");
const cors = require("cors");
const unshort = require("url-unshort");
const { default: axios } = require("axios");

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
  }),
);
const server = http.createServer(app);

const PORT = 4000;
// 全局存放新建的 license: key:session_id,value:license_value
const Licenses = {};

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
// APIs

app.post("/stripe/webhook", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  console.log("stripe sig", sig, req.rawBody);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_VERA_SECRET,
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
        // Then define and call a function to handle the event payment_intent.succeeded
      }
      break;
    // ... handle other event types
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
  res.send();
});

const generateLicense = async (md, token = null) => {
  const resp = await axios.post("https://license.privoce.com/license/gen", md, {
    headers: {
      "Content-Type": "application/json",
      Token: token ?? process.env.VOCE_LICENSE_TOKEN,
    },
  });
  console.log("vocechat license", resp.data);
  return resp.data;
};
const unshortIt = unshort();
app.get("/expand_url", async (req, res) => {
  const link = req.query["u"];
  try {
    const url = await unshortIt.expand(link);
    return res.status(200).send({ expandedURL: url || link, url: link });
  } catch (error) {
    return res.status(200).send({ expandedURL: "", url: link });
  }
});
// vocechat webhook
app.get("/vocechat/webhook", async (req, res) => {
  return res.status(200).send("OK!");
});
app.post("/vocechat/webhook", async (req, res) => {
  const data = req.body;
  console.log("vocechat webhook data", data);
  return res.send({
    data,
  });
});
// vocechat license checker
app.get("/vocechat/licenses/:stripe_session_id", async (req, res) => {
  const { stripe_session_id = "" } = req.params;
  const license = Licenses[stripe_session_id] || "";
  if (license) {
    delete Licenses[stripe_session_id];
    return res.send({
      license,
    });
  }
  return res.status(404).send("Not Found License");
});
// vocechat license generator for web app
app.post("/vocechat/license", async (req, res) => {
  const { stripe_session_id = "", domain = "" } = req.body;
  const license = Licenses[stripe_session_id] || "";
  if (license && license.expiry_at && domain) {
    license.domain = domain;
    try {
      const { code, data } = await generateLicense(license);
      if (code == 0) {
        // 生成成功 立即删掉记录
        delete Licenses[stripe_session_id];
        return res.status(200).json({ license: data.license });
      }
      return res.status(400).send("bad request!");
    } catch (error) {
      console.log("voce err", error);
      return res.status(500).send("license gen failed!");
    }
  }
  return res.status(404).send("Not Found License");
});
// vocechat license generator for landing
const WhiteMap = {};
const envString = process.env.VOCE_LICENSE_PASSWORD ?? "";
envString.split("|").forEach((item) => {
  if (item.includes(":")) {
    const [secret, name] = item.split(":");
    WhiteMap[secret] = name;
  }
});
// 先配对
app.post("/vocechat/landing/license/pair", async (req, res) => {
  const { secret } = req.body;
  const name = WhiteMap[secret];
  if (!name) return res.status(401).send("Not Authenticated");
  return res.status(200).json({ name });
});

app.post("/vocechat/landing/license", async (req, res) => {
  const { secret, data: reqData } = req.body;
  if (!WhiteMap[secret]) return res.status(401).send("Not Authenticated");
  if (reqData) {
    try {
      const { code, data } = await generateLicense(reqData);
      if (code == 0) {
        // 生成成功
        // 通过 bot 给 vocechat 发消息
        const botData = [
          "## from",
          `**${WhiteMap[secret]}**`,
          "## data",
          "```json",
          JSON.stringify(reqData),
          "```",
          "## license",
          `**${data.license}**`,
        ].join("\n");
        axios
          .post("https://dev.voce.chat/api/bot/send_to_group/166", botData, {
            headers: {
              "content-type": "text/markdown",
              "x-api-key": process.env.VOCE_LICENSE_BOT,
            },
          })
          .then((resp) => {
            console.log("发送成功，消息 ID：", resp.data);
          })
          .catch((err) => {
            console.error("发送失败：", JSON.stringify(err, 2), data);
          });
        //  return license content
        return res.status(200).json({ license: data.license });
      }
      return res.status(400).send("bad request!");
    } catch (error) {
      console.log("voce err", error);
      return res.status(500).send("license gen failed!");
    }
  }
  return res.status(400).send("bad request!");
});
// vocechat stripe payment link gen
app.post("/vocechat/payment/create", async (req, res) => {
  const {
    priceId,
    metadata,
    cancel_url,
    success_url,
    mode = "payment",
  } = req.body;
  console.log("vocechat payment metadata", metadata);
  // const { expire, user_limit, domain } =metadata;
  // For full details see https://stripe.com/docs/api/checkout/sessions/create
  // 标识一下来自于 vocechat 的付款
  metadata.from = "vocechat";
  try {
    const session = await stripe.checkout.sessions.create({
      mode,
      // 支付宝和微信不支持订阅制
      payment_method_types:
        mode == "subscription" ? ["card"] : ["card", "alipay", "wechat_pay"],
      metadata,
      payment_method_options:
        mode == "subscription"
          ? undefined
          : {
              wechat_pay: {
                client: "web",
              },
            },
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      // ?session_id={CHECKOUT_SESSION_ID} means the redirect will have the session ID set as a query param
      success_url: `${success_url}/{CHECKOUT_SESSION_ID}`,
      cancel_url,
      // automatic_tax: { enabled: true }
    });
    return res.send({
      session_url: session.url,
    });
  } catch (e) {
    res.status(400);
    console.log("vocechat payment link error", JSON.stringify(e));
    return res.send({
      error: {
        message: e.message,
      },
    });
  }
});
// vocechat stripe webhook
app.post("/stripe/webhook/vocechat", async (req, res) => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    console.log("vocechat webhook error: no sig");
    res.status(400).send("No Sig");
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_VOCECHAT_SECRET,
    );
  } catch (err) {
    console.log("vocechat webhook construct error: ", err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }
  console.log("stripe event", event.type);
  if (event.type == "checkout.session.completed") {
    const { metadata, id } = event.data.object;
    console.log("event data", id, metadata);
    // 只处理来自 vocechat 的付款请求
    if (metadata && metadata.from == "vocechat") {
      const md = {
        expiry_at: metadata.expire,
        user_limit: +metadata.user_limit,
        domain: metadata.domain,
      };
      // 没填 domain，则暂时记录下 session_id
      if (!md.domain) {
        Licenses[id] = md;
        return res.status(200);
      }
      // 记录到内存
      try {
        const { code, data } = await generateLicense(md);
        if (code == 0) {
          // 生成成功
          Licenses[id] = data.license;
          return res.status(200).json({ license: data.license });
        }
        return res.status(400).send("bad request!");
      } catch (error) {
        console.log("voce err", error);
        return res.status(500).send("license gen failed!");
      }
    }
  }
  res.send();
});

// PUT https://privoce.voce.chat/api/license

// voce 第三方登录，拿 token
const third_domain = "webrowse.voce.chat";
app.get("/voce/oauth/:uid/:uname", async (req, res) => {
  const { uid, uname } = req.params;
  if (!uid || !uname) return res.json(null);
  try {
    const resp = await axios.post(
      `https://${third_domain}/api/token/create_third_party_key`,
      { userid: uid, username: uname },
      {
        headers: {
          "Content-Type": "application/json",
          "X-SECRET": process.env.VOCE_SECRET,
        },
      },
    );
    console.log("voce", resp.data);
    return res.json({
      link: `https://${third_domain}/#/oauth/${resp.data}`,
      token: resp.data,
    });
  } catch (error) {
    console.log("voce err", error);
    return res.json(null);
  }
});
