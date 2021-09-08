const getRoomInstance = require("./Room");
const getWindowInstance = require("./Window");
const {
    gRequest,
    // QUERY_ROOM_LIST,
    INSERT_TABS,
    NEW_ROOM,
    NEW_WINDOW,
    DELETE_TABS
} = require("./graphqlClient");
const CURRENT_USERS = "CURRENT_USERS";
const JOIN_MEETING = "JOIN_MEETING";
const TAB_EVENT = "TAB_EVENT";
const UPDATE_USERS = "UPDATE_USERS";
const USER_LEAVE = "USER_LEAVE";
const USER_ENTER = "USER_ENTER";

const initWebrowseSocket = async (io, socket, params = {}) => {
    const { roomId, winId = "", temp = false, userInfo } = params;
    if (!winId) return;
    const socketRoom = `${winId}`;
    socket.join(socketRoom);
    // room factory
    const CurrentRoom = await getRoomInstance({ id: roomId, temp });
    const CurrentWindow = await getWindowInstance({ id: winId, temp: winId.endsWith("_temp") });
    console.log({ CurrentRoom, CurrentWindow, roomId, winId, userInfo });
    // 当前暂存内存中的user，id指的是当前ws连接的id，uid指的是authing的uid，和authing保持一致
    const member = {
        id: socket.id,
        uid: userInfo.uid,
        photo: userInfo.photo,
        username: userInfo.username,
        activeIndex: 0,
        // peerId 非空，则代表webrtc连接建立
    };
    CurrentWindow.appendMember(member);
    // 当前用户
    const currUser = { ...member };
    // 临时room的创建者 or 本身就是该room的创建者 or 个人room
    if (temp || (currUser.uid && CurrentRoom.creator == currUser.username) || (currUser.uid == CurrentRoom.id)) {
        currUser.creator = true;
    }
    CurrentWindow.addActiveUser(socket.id, currUser);
    const { title, members } = CurrentWindow;
    socket.emit(CURRENT_USERS, { title, room: { id: CurrentRoom.id, name: CurrentRoom.name, temp, members }, workspaceData: CurrentWindow.workspaceData, users: CurrentWindow.activeUsers });

    // new user
    socket.on("message", (data) => {
        console.log(data);
        const { cmd = USER_ENTER, payload = {} } = data;
        console.log({ payload });
        switch (cmd) {
            case TAB_EVENT: { // tab CRUD
                console.log("tab event");
                const wsData = payload.data;
                // 更新内存中对应用户的活动tab
                CurrentWindow.updateUser(socket.id, { activeIndex: wsData.activeTabIndex });
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                // 广播最新的 workspace 数据
                // 只有host才会更新activeIndex
                const isHost = CurrentWindow.users[socket.id].host;
                if (!isHost) {
                    delete wsData.activeTabIndex;
                }
                socket.broadcast.in(socketRoom).emit(TAB_EVENT, { data: wsData });
                CurrentWindow.workspaceData = { ...CurrentWindow.workspaceData, ...wsData };
            }
                break;
            case JOIN_MEETING: {
                // 建立webrtc连接，加入meeting
                CurrentWindow.updateUser(socket.id, { meeting: true });
                // 只通知meeting中的用户
                let notifyUsers = CurrentWindow.activeUsers.filter(u => u.meeting && u.id !== socket.id);
                notifyUsers.forEach(user => {
                    socket.broadcast.to(user.id).emit(JOIN_MEETING, CurrentWindow.users[socket.id]);
                });
                //加入meeting，更新user list
                // socket.broadcast.in(socketRoom).emit(JOIN_MEETING, CurrentWindow.users[socket.id]);
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
            }
                break;
            case "LEAVE_MEETING":
                // 离开meeting
                CurrentWindow.updateUser(socket.id, { meeting: false });
                //离开meeting，更新user list
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
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
            case "BE_HOST":
                // 成为房主
                CurrentWindow.beHost(socket.id, payload.enable);
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                break;
            case "FOLLOW_MODE":
                // 是否开启follow mode
                CurrentWindow.updateUser(socket.id, { follow: payload.follow });
                io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                break;
            case "PEER_ID":
                // 更新peerid
                CurrentWindow.updateUser(socket.id, { peerId: payload.peerId });
                // 更新自己的
                socket.emit(CURRENT_USERS, { workspaceData: CurrentWindow.workspaceData, users: CurrentWindow.activeUsers, update: true });
                // io.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
                break;
            case "KEEP_ROOM":
                // 有用户选择保留房间
                CurrentWindow.addKeepUser(socket.id);
                break;
            case "RAW_TABS": {
                //更新原始tab list信息
                const { tabs } = payload;
                CurrentWindow.tabs = tabs;
            }
                break;
            case "KEEP_TABS": {
                //更新覆盖数据库里的tabs
                const { tabs } = payload;
                if (winId.endsWith("_temp")) {
                    // 临时window
                    if (roomId == currUser.uid) {
                        const upsertRoom = { id: roomId, host: currUser.username };
                        gRequest(NEW_ROOM, upsertRoom).then(({ insert_portal_room: { returning: [{ id }] } }) => {
                            // upsert room  success
                            gRequest(NEW_WINDOW, { room: id, title: `window - created ${new Date().toLocaleDateString("en-US")}` }).then(({ insert_portal_window: { returning: [{ id }] } }) => {
                                // 创建新window成功
                                console.log("new window id", id);
                                gRequest(INSERT_TABS, {
                                    tabs: tabs.map(t => {
                                        return { ...t, window: id };
                                    })
                                }).then((wtf) => {
                                    console.log("插入tabs成功", wtf);
                                });
                            });
                        });
                    } else {
                        gRequest(NEW_WINDOW, { room: roomId, title: `window - created ${new Date().toLocaleDateString("en-US")}` }).then(({ insert_portal_window: { returning: [{ id }] } }) => {
                            // 创建新window成功
                            console.log("new window id", id);
                            gRequest(INSERT_TABS, {
                                tabs: tabs.map(t => {
                                    return { ...t, window: id };
                                })
                            }).then((wtf) => {
                                console.log("插入tabs成功", wtf);
                            });
                        });
                    }
                } else {
                    // 直接覆盖式更新
                    gRequest(DELETE_TABS, { wid: winId }).then(() => {
                        console.log("insert new tabs");
                        // 删除成功
                        console.log("insert new tabs", tabs);
                        gRequest(INSERT_TABS, {
                            tabs: tabs.map(t => {
                                return { ...t, window: winId };
                            })
                        }).then((wtf) => {
                            console.log(wtf);
                        });
                    });
                }
            }
                break;
            case "END_ALL": {
                //结束房间内的所有连接 并把房间销毁
                io.in(socketRoom).disconnectSockets(true);
                CurrentWindow.destory();
            }
                break;
        }
        // 广播给所有的zoom socket 连接
        io.in(`${roomId}_zoom`).emit("ZOOM_VERA_DATA", { tabs: CurrentWindow.tabs || [], users: CurrentWindow.activeUsers });
    });
    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        // ping timeout 先忽略？
        // if (reason == "ping timeout") return;
        CurrentWindow.removeActiveUser(socket.id);
        socket.broadcast.in(socketRoom).emit(UPDATE_USERS, { users: CurrentWindow.activeUsers });
        io.in(socketRoom).emit(USER_LEAVE, currUser);
        socket.leave(socketRoom);
    });
};
module.exports = { initWebrowseSocket };