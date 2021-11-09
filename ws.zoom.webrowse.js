const { Windows } = require("./Window");

const initZoomWebrowseSocket = async (io, socket, params = {}) => {
    const { winId, roomId } = params;
    if (!winId) return;
    socket.join(`${winId}_zoom`);
    // 立即发送当前数据
    const currentWindow = Windows[winId] || null;
    let initData = currentWindow ? { winId, roomId, tabs: currentWindow.tabs || [], users: currentWindow.activeUsers } : { tabs: [], users: [] };
    socket.emit("ZOOM_WEBROWSE_DATA", initData);

    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        socket.leave(`${winId}_zoom`);
    });
};
module.exports = { initZoomWebrowseSocket };