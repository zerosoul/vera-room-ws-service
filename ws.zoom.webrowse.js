const { Windows } = require("./Window");

const initZoomWebrowseSocket = async (io, socket, params = {}) => {
    const { roomId } = params;
    if (!roomId) return;
    socket.join(`${roomId}_zoom`);
    // 立即发送当前数据
    const currentRoom = Windows[roomId] || null;
    let initData = currentRoom ? { tabs: currentRoom.tabs || [], users: currentRoom.activeUsers } : { tabs: [], users: [] };
    socket.emit("ZOOM_WEBROWSE_DATA", initData);

    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        socket.leave(`${roomId}_zoom`);
    });
};
module.exports = { initZoomWebrowseSocket };