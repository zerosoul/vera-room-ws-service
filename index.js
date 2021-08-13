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
const CURRENT_USERS = "CURRENT_USERS";
const JOIN_MEETING = "JOIN_MEETING";
const TAB_EVENT = "TAB_EVENT";
const UPDATE_USERS = "UPDATE_USERS";
const USER_LEAVE = "USER_LEAVE";
const USER_ENTER = "USER_ENTER";
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
    activeIndex: 0,
    // peerId 非空，则代表webrtc连接建立
    peerId,
  };
  CurrentRoom.appendMember(member);
  // 当前用户
  const currUser = { ...member };
  // 第一个进来，初始化房间人数为1
  if (CurrentRoom.activeUsers.length == 0) {
    // 临时room的创建者
    if (temp) {
      currUser.creator = true;
    }
  }
  CurrentRoom.addActiveUser(socket.id, currUser);
  const { id, name, temp: isTemp, link: defaultLink, members } = CurrentRoom;
  socket.emit(CURRENT_USERS, { room: { id, name, temp: isTemp, link: defaultLink, members }, users: CurrentRoom.activeUsers });

  // new user
  socket.on("message", (data) => {
    console.log(data);
    const { cmd = USER_ENTER, payload = {} } = data;
    console.log({ payload });
    switch (cmd) {
      case TAB_EVENT: { // tab CRUD
        console.log("tab event");
        const wsData = payload.data;
        // 更新内存中的活动tab
        CurrentRoom.updateUser(socket.id, { activeIndex: wsData.activeTabIndex });
        io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        const fromHost = CurrentRoom.users[socket.id].host;
        socket.broadcast.in(roomId).emit(TAB_EVENT, { data: payload.data, fromHost });
        console.log("current users", CurrentRoom.users);
        if (fromHost) {
          // 只有host才会更新activeIndex
          CurrentRoom.workspaceData = wsData;
        } else {
          wsData.activeTabIndex = CurrentRoom.workspaceData?.activeTabIndex;
          CurrentRoom.workspaceData = wsData;
        }
      }
        break;
      case JOIN_MEETING: {
        // 建立webrtc连接，加入meeting
        CurrentRoom.updateUser(socket.id, { meeting: true });
        // 只通知meeting中的用户
        let notifyUsers = CurrentRoom.activeUsers.filter(u => u.meeting && u.id !== socket.id);
        notifyUsers.forEach(user => {
          socket.broadcast.to(user.id).emit(JOIN_MEETING, CurrentRoom.users[socket.id]);
        });
        //加入meeting，更新user list
        // socket.broadcast.in(roomId).emit(JOIN_MEETING, CurrentRoom.users[socket.id]);
        io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
      }
        break;
      case "LEAVE_MEETING":
        // 离开meeting
        CurrentRoom.updateUser(socket.id, { meeting: false });
        //离开meeting，更新user list
        io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        break;
      case USER_ENTER:
        // add user
        // 向房间内其它人广播新加入的用户
        socket.broadcast.in(roomId).emit(USER_ENTER, CurrentRoom.addActiveUser(socket.id, currUser));
        // 更新自己的
        socket.emit(CURRENT_USERS, { workspaceData: CurrentRoom.workspaceData, users: CurrentRoom.activeUsers, update: true });
        //新人加入，更新user list
        socket.broadcast.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        break;
      case "BE_HOST":
        // 成为房主
        CurrentRoom.beHost(socket.id, payload.enable);
        io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        break;
      case "FOLLOW_MODE":
        // 是否开启follow mode
        CurrentRoom.updateUser(socket.id, { follow: payload.follow });
        io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        break;
      case "PEER_ID":
        // 更新peerid
        CurrentRoom.updateUser(socket.id, { peerId: payload.peerId });
        // 更新自己的
        socket.emit(CURRENT_USERS, { workspaceData: CurrentRoom.workspaceData, users: CurrentRoom.activeUsers, update: true });
        // io.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
        break;
      case "KEEP_ROOM":
        // 有用户选择保留房间
        CurrentRoom.addKeepUser(socket.id);
        break;
    }
  });
  // Leave the room if the user closes the socket
  socket.on("disconnect", (reason) => {
    console.log("disconnect reason", reason);
    // ping timeout 先忽略？
    // if (reason == "ping timeout") return;
    CurrentRoom.removeActiveUser(socket.id);
    socket.broadcast.in(roomId).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
    io.in(roomId).emit(USER_LEAVE, currUser);
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

