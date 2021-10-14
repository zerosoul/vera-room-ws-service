const getRoomInstance = require("./Room");
const CURRENT_USERS = "CURRENT_USERS";
const JOIN_MEETING = "JOIN_MEETING";
const UPDATE_USERS = "UPDATE_USERS";
const USER_LEAVE = "USER_LEAVE";
const USER_ENTER = "USER_ENTER";

const initVeraSocket = async (io, socket, params = {}) => {
    const { roomId, temp = false, link, peerId, userInfo } = params;
    if (!roomId) return;
    const socketRoom = `${roomId}`;
    socket.join(socketRoom);
    // room factory
    const CurrentRoom = await getRoomInstance({ id: roomId, temp, link });
    console.log({ CurrentRoom, roomId, userInfo });
    // 当前暂存内存中的user，id指的是当前ws连接的id，uid指的是authing的uid，和authing保持一致
    const member = {
        id: socket.id,
        uid: userInfo.uid,
        photo: userInfo.photo,
        username: userInfo.username,
        // peerId 非空，则代表webrtc连接建立
        peerId,
    };
    // 当前用户
    const currUser = { ...member };
    // 第一个进来，初始化房间人数为1
    if (CurrentRoom.activeUsers.length == 0) {
        // 临时room的创建者
        if (temp) {
            currUser.creator = true;
            currUser.meeting = true;
        }
    }
    CurrentRoom.addActiveUser(socket.id, currUser);
    const { id, temp: isTemp } = CurrentRoom;
    socket.emit(CURRENT_USERS, { room: { id, temp: isTemp }, users: CurrentRoom.activeUsers });

    // new user
    socket.on("message", (data) => {
        console.log(data);
        const { cmd = USER_ENTER, payload = {} } = data;
        console.log({ payload });
        switch (cmd) {
            case JOIN_MEETING: {
                // 建立webrtc连接，加入meeting
                CurrentRoom.updateUser(socket.id, { meeting: true });
                // 只通知meeting中的用户
                let notifyUsers = CurrentRoom.activeUsers.filter(u => u.meeting && u.id !== socket.id);
                console.log("meeting users", notifyUsers);
                notifyUsers.forEach(user => {
                    socket.broadcast.to(user.id).emit(JOIN_MEETING, CurrentRoom.users[socket.id]);
                });
                //加入meeting，更新user list
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
            }
                break;
            case "LEAVE_MEETING":
                // 离开meeting
                CurrentRoom.updateUser(socket.id, { meeting: false });
                //离开meeting，更新user list
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
                break;
            case USER_ENTER:
                // add user
                // 向房间内其它人广播新加入的用户
                socket.broadcast.in(socketRoom).emit(USER_ENTER, CurrentRoom.addActiveUser(socket.id, currUser));
                // 更新自己的
                socket.emit(CURRENT_USERS, { users: CurrentRoom.activeUsers, update: true });
                //新人加入，更新user list
                socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentRoom.activeUsers });
                break;
            case "PEER_ID":
                // 更新peerid
                CurrentRoom.updateUser(socket.id, { peerId: payload.peerId });
                // 更新自己的
                socket.emit(CURRENT_USERS, { users: CurrentRoom.activeUsers, update: true });
                break;
            case "SYNC_PLAYER":
                //同步播放器的状态
                socket.broadcast.in(socketRoom).emit("SYNC_PLAYER", { ...payload });
                break;
            case "SYNC_URL":
                //同步url的更新
                socket.broadcast.in(socketRoom).emit("SYNC_URL", { url: payload.url });
                break;
        }
    });
    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        // ping timeout 先忽略？
        // if (reason == "ping timeout") return;
        CurrentRoom.removeActiveUser(socket.id);
        io.in(socketRoom).emit(USER_LEAVE, currUser);
        socket.leave(socketRoom);
    });
};
module.exports = { initVeraSocket };