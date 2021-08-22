const getRoomInstance = require("./Room");

const initZoomVeraSocket = async (io, socket, params = {}) => {
    const { roomId } = params;
    if (!roomId) return;
    socket.join(`${roomId}_zoom`);
    // 立即发送当前数据
    const CurrentRoom = await getRoomInstance({ id: roomId });
    socket.emit("ZOOM_VERA_DATA", { tabs: CurrentRoom.workspaceData?.tabs || [], users: CurrentRoom.activeUsers });

    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        socket.leave(`${roomId}_zoom`);
    });
};
module.exports = { initZoomVeraSocket };