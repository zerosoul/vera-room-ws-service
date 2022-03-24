const getRoomInstance = require("./Room");
const getWindowInstance = require("./Window");
const CURRENT_USERS = "CURRENT_USERS";
// const JOIN_MEETING = "JOIN_MEETING";
const TAB_EVENT = "TAB_EVENT";
const WORKSPACE = "WORKSPACE";
const UPDATE_USERS = "UPDATE_USERS";
const USER_LEAVE = "USER_LEAVE";
const USER_ENTER = "USER_ENTER";

const initWebrowseSocket = async (io, socket, params = {}) => {
    const { roomId, winId = "", title: initialTitle, temp = false, invited = false, userInfo } = params;
    if (!winId) return;
    const socketRoom = `${winId}`;
    socket.join(socketRoom);
    // room factory
    const CurrentRoom = await getRoomInstance({ id: roomId, temp });
    const CurrentWindow = await getWindowInstance({ id: winId, roomId, temp: winId.endsWith("_temp"), title: initialTitle });
    console.log({ CurrentRoom, CurrentWindow, roomId, winId, userInfo, invited });
    // 当前暂存内存中的user，id指的是当前ws连接的id，uid指的是authing的uid，和authing保持一致
    const member = {
        id: socket.id,
        uid: userInfo.uid,
        photo: userInfo.photo,
        username: userInfo.username,
        activeIndex: 0,
        intUid: +userInfo.intUid || 0,
        // peerId 非空，则代表webrtc连接建立
    };
    CurrentWindow.appendMember(member);
    // 当前用户
    const currUser = { ...member };
    // 临时room的创建者 or 本身就是该room的创建者 or 个人room
    if (temp || (currUser.uid && CurrentRoom.creator == currUser.username) || (currUser.uid == CurrentRoom.id)) {
        currUser.creator = true;
    }
    // 第一个进入房间的人，默认host，否则设置follow
    if (CurrentWindow.activeUsers.length == 0) {
        currUser.host = true;
        if (invited && CurrentWindow.tabs) {
            CurrentWindow.workspaceData = { tabs: CurrentWindow.tabs };
            console.log("invited", CurrentWindow.workspaceData);
        }
    } else {
        let currHost = CurrentWindow.activeUsers.find(u => u.host);
        if (currHost) {
            currUser.follow = true;
            currUser.activeIndex = currHost.activeIndex;
        }
    }
    CurrentWindow.addActiveUser(socket.id, currUser);
    const { title, members } = CurrentWindow;
    socket.emit(CURRENT_USERS, { title, room: { id: CurrentRoom.id, name: CurrentRoom.name, temp, members }, workspaceData: CurrentWindow.workspaceData, users: CurrentWindow.activeUsers });
    // 广播给其它人：更新活跃用户
    socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
    // 向房间内其它人广播新加入的用户
    socket.broadcast.in(socketRoom).emit(USER_ENTER, currUser);
    // new user
    socket.on("message", async (data) => {
        console.log(data);
        const { cmd = USER_ENTER, payload = {} } = data;
        console.log({ payload });
        switch (cmd) {
            case TAB_EVENT: {
                const { type, tab } = payload;
                console.log("tab event", type, tab);
                socket.broadcast.in(socketRoom).emit(TAB_EVENT, { username: currUser.username, type, tab });
            }
                break;
            case WORKSPACE: { // workspace event
                const { workspace: wsData } = payload;
                console.log("workspace event", wsData);
                // 更新内存中对应用户的活动tab
                CurrentWindow.updateUser(socket.id, { activeIndex: wsData.activeTabIndex });
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                // 广播最新的 workspace 数据
                // 只有host才会更新activeIndex
                const isHost = CurrentWindow.users[socket.id].host;
                if (!isHost) {
                    delete wsData.activeTabIndex;
                }
                socket.broadcast.in(socketRoom).emit(WORKSPACE, { data: wsData, fromHost: isHost });
                CurrentWindow.workspaceData = { ...CurrentWindow.workspaceData, ...wsData };
            }
                break;
            case USER_ENTER:
                // add user
                // 向房间内其它人广播新加入的用户
                socket.broadcast.in(socketRoom).emit(USER_ENTER, CurrentWindow.addActiveUser(socket.id, currUser));
                // 更新自己的
                socket.emit(CURRENT_USERS, { workspaceData: CurrentWindow.workspaceData, users: CurrentWindow.activeUsers, update: true });
                //新人加入，更新user list
                socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                break;
            case "BE_HOST": {
                // 成为房主
                const { enable, workspace } = payload;
                CurrentWindow.beHost(socket.id, enable);
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                if (enable && workspace) {
                    // 立即同步房主的信息
                    socket.broadcast.in(socketRoom).emit(WORKSPACE, { data: workspace, fromHost: true });
                }
            }
                break;
            case "FOLLOW_MODE":
                // 是否开启follow mode
                CurrentWindow.updateUser(socket.id, { follow: payload.follow });
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                break;
            case "RAW_TABS": {
                //更新原始tab list信息
                const { tabs } = payload;
                CurrentWindow.tabs = tabs;
            }
                break;
            case "END_ALL": {
                //结束房间内的所有连接 并把房间销毁
                io.in(socketRoom).disconnectSockets();
                CurrentWindow.destory();
            }
                break;
            case "UPDATE_WIN_TITLE": {
                //更新window title
                const { title } = payload;
                CurrentWindow.title = title;
                io.in(socketRoom).emit("UPDATE_WIN_TITLE", { title });
            }
                break;
            case "ACCESS_TIP": {
                //提醒host有access权限问题
                const { site, index } = payload;
                let currHost = CurrentWindow.activeUsers.find(u => u.host);
                if (currHost) {
                    const sockets = await io.in(socketRoom).fetchSockets();
                    const hostSocket = sockets.find(s => s.id == currHost.id);
                    if (hostSocket) {
                        hostSocket.emit("ACCESS_TIP", { site, index });
                    }
                }
            }
                break;
            case "HOST_CURSOR": {
                //广播给其它人
                socket.broadcast.in(socketRoom).emit("HOST_CURSOR", payload);
            }
                break;
        }
        // 广播给所有的zoom socket 连接
        io.in(`${winId}_zoom`).emit("ZOOM_WEBROWSE_DATA", { tabs: CurrentWindow.tabs || [], users: CurrentWindow.activeUsers });
    });
    socket.on("error", (err) => {
        socket.leave(socketRoom);
        console.log("connection error", err.message);
        // clear connection data
        CurrentWindow.removeActiveUser(socket.id);
        socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
        io.in(socketRoom).emit(USER_LEAVE, currUser);
    });
    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        socket.leave(socketRoom);
        console.log("disconnect reason", reason);
        // ping timeout 先忽略？
        // if (reason == "ping timeout") return;
        CurrentWindow.removeActiveUser(socket.id);
        socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
        io.in(socketRoom).emit(USER_LEAVE, currUser);
    });
};
module.exports = { initWebrowseSocket };
