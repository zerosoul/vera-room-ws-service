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
const getRoomInstance = require("./Room");


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
const CURRENT_PEERS = "CURRENT_PEERS_EVENT";
const PEER_JOIN_EVENT = "PEER_JOIN_EVENT";
const TAB_EVENT = "TAB_EVENT";
const UPDATE_TABS = "UPDATE_TABS";
// const CURRENT_TABS = "CURRENT_TABS";
const UPDATE_ACTIVE_TAB = "UPDATE_ACTIVE_TAB";
const UPDATE_USERS = "UPDATE_USERS";
// const USERNAME_UPDATE_EVENT = 'USERNAME_UPDATE_EVENT'
// const SOMEONE_INFO_UPDATE = 'SOMEONE_INFO_UPDATE'
const PEER_LEAVE_EVENT = "PEER_LEAVE_EVENT";
io.on("connection", async (socket) => {
  console.log(`${socket.id} connected`);
  // Join a room
  const {
    roomId, winId, temp = false, link, peerId, ...userInfo
  } = socket.handshake.query;
  socket.join(roomId);
  // room factory
  const CurrentRoom = await getRoomInstance({ id: roomId, temp, link });
  console.log({ CurrentRoom, roomId, winId });
  // 当前暂存内存中的user，id指的是当前ws连接的id，uid指的是authing的uid，和authing保持一致
  const member = {
    id: socket.id,
    uid: userInfo.uid,
    photo: userInfo.photo,
    username: userInfo.username,
    activePage: link
  };
  CurrentRoom.appendMember(member);

  // 当前用户
  const currUser = { peerId, ...userInfo };
  // 第一个进来，初始化房间人数为1
  let host = false;
  if (CurrentRoom.activeUsers.length == 0) {
    host = true;
    currUser.host = true;
    // 临时room的创建者
    if (temp) {
      currUser.creator = true;
    }
    CurrentRoom.addActiveUser(socket.id, currUser);
  }
  socket.emit(CURRENT_PEERS, { users: CurrentRoom.activeUsers, host });

  // new user
  socket.on("message", (data) => {
    console.log(data);
    const { cmd = "NEW_PEER", payload = null } = data;
    console.log({ payload });
    switch (cmd) {
      case TAB_EVENT:
        // 新开的tab
        console.log("tab event");
        socket.broadcast.in(roomId).emit(TAB_EVENT, payload);
        CurrentRoom.workspaceData = payload.data;
        break;
      case "NEW_PEER":
        // add user
        // 向房间内其它人广播新加入的用户
        socket.broadcast.in(roomId).emit(PEER_JOIN_EVENT, CurrentRoom.addActiveUser(socket.id, currUser));
        // 更新自己的
        socket.emit(CURRENT_PEERS, { workspaceData: CurrentRoom.workspaceData, users: CurrentRoom.activeUsers, update: true });
        break;
      case UPDATE_TABS:
        // 更新内存中的tab集合
        console.log("UPDATE_TABS", payload.data);
        CurrentRoom.tabs = payload.data;
        break;
      case UPDATE_ACTIVE_TAB:
        // 更新内存活动tab
        CurrentRoom.updateActiveTab(socket.id, payload.url);
        socket.broadcast.in(roomId).emit(UPDATE_USERS, CurrentRoom.activeUsers);
        break;
      case "KEEP_ROOM":
        // 有用户选择保留房间
        CurrentRoom.addKeepUser(socket.id);
        break;

      default:
        break;
    }
  });
  // Leave the room if the user closes the socket
  socket.on("disconnect", (reason) => {
    console.log("disconnect reason", reason);
    // ping timeout 先忽略？
    // if (reason == "ping timeout") return;
    CurrentRoom.removeActiveUser(socket.id);
    io.in(roomId).emit(PEER_LEAVE_EVENT, currUser);
    socket.leave(roomId);
  });
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
// APIs
// app.get("/rooms/:roomId/users", (req, res) => {
//   const users = getUsersInRoom(req.params.roomId);
//   return res.json({ users });
// });
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

