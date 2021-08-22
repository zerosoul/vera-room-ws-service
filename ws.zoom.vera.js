const initZoomVeraSocket = async (io, socket, params = {}) => {
    const { roomId } = params;
    if (!roomId) return;
    socket.join(`${roomId}_zoom`);

    // new user
    // socket.on("message", (data) => {
    //     console.log(data);
    //     const { cmd = USER_ENTER, payload = {} } = data;
    //     console.log({ payload });
    //     switch (cmd) {
    //         case TAB_EVENT: { // tab CRUD
    //             console.log("tab event");
    //             const wsData = payload.data;
    //             // 更新内存中的活动tab
    //         }
    //             break;
    //     }
    // });
    // Leave the room if the user closes the socket
    socket.on("disconnect", (reason) => {
        console.log("disconnect reason", reason);
        socket.leave(`${roomId}_zoom`);
    });
};
module.exports = { initZoomVeraSocket };