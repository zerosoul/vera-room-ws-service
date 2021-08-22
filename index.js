require("dotenv").config();
const http = require("http");
const express = require("express");
const cors = require("cors");
const socketIo = require("socket.io");
const { ManagementClient } = require("authing-js-sdk");
const { arrayChunks } = require("./utils");
const {
  gRequest,
  QUERY_ROOM_LIST,
} = require("./graphqlClient");
const { initVeraSocket } = require("./ws.vera");
const { initZoomVeraSocket } = require("./ws.zoom.vera");
const { Rooms } = require("./Room");

const managementClient = new ManagementClient({
  userPoolId: "6034a31382f5d09e3b5a15fa",
  secret: process.env.AUTHING_SECRET,
});
const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  upgradeTimeout: 40000,
  pingTimeout: 50000
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
        roomId, winId, temp = false, link, peerId, ...userInfo
      } = rest;
      initVeraSocket(io, socket, { roomId, winId, temp, link, peerId, userInfo });
    }
      break;
    case "ZOOM_VERA": {
      const {
        roomId
      } = rest;
      initZoomVeraSocket(io, socket, { roomId });
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
  Object.entries(Rooms).forEach(([rid, room]) => {
    if (!room) return;
    console.log("get zoom id with uid:", rid, room.activeUsers);
    let us = room.activeUsers;
    if (us.findIndex((u) => u.uid == uid) > -1) {
      room_id = rid;
    }
  });
  return res.json({
    room_id
  });
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

