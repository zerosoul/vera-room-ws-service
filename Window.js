const {
    gRequest,
    QUERY_WINDOW,
    UPDATE_WINDOW_ACTIVE,
    UPDATE_WINDOW_MEMBERS,
    // NEW_WINDOW
} = require("./graphqlClient");
const { sameUser } = require("./utils");
const Windows = {};
// 只保留需要的字段
const filterMemberFields = (member = null) => {
    if (!member) return member;
    let keeps = ["id", "uid", "username", "avator", "creator", "photo"];
    let tmp = {};
    Object.keys(member).forEach(k => {
        if (keeps.includes(k) && typeof member[k] !== "undefined") {
            tmp[k] = member[k];
        }
    });
    return tmp;
};
class Window {
    constructor({ id, roomId, temp = false, title = "" }) {
        this.id = id;
        this.title = title;
        this.temp = temp;
        this.active = false;
        this.members = [];
        this.users = {};
        this.roomId = roomId;
        this.room = {};
        this.tabs = null;
        this.workspaceData = null;
    }
    get activeUsers() {
        console.log("current users", this.users);
        return Object.values(this.users);
    }
    async fetchData() {
        console.log("start fetch", this.temp, typeof this.temp);
        if (this.temp) { return; }
        const result = await gRequest(QUERY_WINDOW, {
            id: this.id,
        });
        console.log("data fetched", result.portal_window);
        if (result && result.portal_window[0]) {
            const [{ title, members, active, roomByRoom, tabs }] = result.portal_window;
            this.title = title;
            this.active = active;
            this.members = members;
            this.room = roomByRoom;
            this.tabs = tabs.map(t => { return { url: t.url }; });
            // 激活当前window
            if (!active) {
                this.setActive();
            }
        }
    }
    setActive() {
        console.log("active the window");
        // 设置为活跃window
        gRequest(UPDATE_WINDOW_ACTIVE, { active: true, id: this.id }).then((wtf) => {
            console.log(wtf);
        });
    }
    setInactive() {
        // 设置为不活跃window
        gRequest(UPDATE_WINDOW_ACTIVE, { active: false, id: this.id }).then((wtf) => {
            console.log(wtf);
        });
    }
    appendMember(member) {
        if (this.temp) return;
        // 更新参与者
        if (!this.members) return;
        // 如果没有uid，就pass掉
        if (!member.uid) return;
        const filterd = this.members.filter((m) => sameUser(m, member));
        console.log("filterd", filterd);
        if (filterd.length == 0) {
            // append member
            console.log("append member", member);
            gRequest(UPDATE_WINDOW_MEMBERS, {
                member: filterMemberFields(member),
                id: this.id,
            });
        }
    }
    addActiveUser(sid, user) {
        console.log("add active user", user);
        // 新增活跃用户
        this.users[sid] = user;
        return user;
    }
    beHost(sid, enable = true) {
        const tmps = Object.entries(this.users);
        const newUsers = enable ? Object.fromEntries(tmps.map(([key, user]) => {
            return [key, { ...user, host: key == sid, follow: key !== sid }];
        })) : Object.fromEntries(tmps.map(([key, user]) => {
            return [key, { ...user, host: false, follow: false }];
        }));
        this.users = { ...newUsers };
    }
    updateUser(sid, params) {
        if (this.users[sid]) {
            this.users[sid] = { ...this.users[sid], ...params };
        }
    }
    destory() {
        if (!this.temp) {
            // 非临时window，设置为非活跃状态
            this.setInactive();
        }
        // 释放掉
        Windows[this.id] = null;
        delete Windows[this.id];
    }
    removeActiveUser(sid) {
        const currUser = this.users[sid];
        if (currUser.host) {
            Object.keys(this.users).forEach(k => {
                this.users[k].follow = false;
            });
        }
        delete this.users[sid];
        // window没人了
        if (this.activeUsers.length == 0) {
            this.destory();
        }
    }

}
const getWindowInstance = async ({ id, roomId, temp, title = "" }) => {
    console.log("current window list", { Windows });
    if (!Windows[id]) {
        console.log("new window obj");
        Windows[id] = new Window({ id, roomId, temp, title });
    }
    await Windows[id].fetchData();
    return Windows[id];
};
module.exports = getWindowInstance;
module.exports.Windows = Windows;