const {
    gRequest,
    QUERY_WINDOW,
    UPDATE_WINDOW_ACTIVE,
    UPDATE_WINDOW_MEMBERS,
    NEW_WINDOW
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
    constructor({ id, temp = false }) {
        this.id = id;
        this.title = "";
        this.temp = temp;
        this.active = false;
        this.members = [];
        this.users = {};
        this.room = {};
        this.tabs = null;
        this.workspaceData = null;
        this.keepUsers = [];
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
            const [{ title, members, active, roomByRoom }] = result.portal_window;
            this.title = title;
            this.active = active;
            this.members = members;
            this.room = roomByRoom;
            // 激活当前window
            if (!active) {
                this.setActive();
            }
        }
    }
    saveToDatabase() {
        // 写回数据库
        let { id } = this;
        const params = { title: "window", id, members: this.keepUsers };
        gRequest(NEW_WINDOW, params).then((wtf) => {
            console.log(wtf);
        });
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
    addKeepUser(sid) {
        //   该用户选择保留临时window
        const avtiveUser = this.activeUsers.find(u => u.id == sid);
        const filterd = this.keepUsers.filter((u) => sameUser(u, avtiveUser));
        if (filterd.length == 0) {
            this.keepUsers = [...this.keepUsers, avtiveUser];
        }
    }
    destory() {
        if (this.temp && this.keepUsers.length) {
            // 临时window，走一下存储逻辑
            console.log("save to db");
            this.saveToDatabase();
        } else {
            // 非临时window，设置为非活跃状态
            this.setInactive();
        }
        // 释放掉
        Windows[this.id] = null;
    }
    removeActiveUser(sid) {
        delete this.users[sid];
        // window没人了
        if (this.activeUsers.length == 0) {
            this.destory();

        }
    }

}
const getWindowInstance = async ({ id, temp }) => {
    if (!Windows[id]) {
        Windows[id] = new Window({ id, temp });
    }
    await Windows[id].fetchData();
    return Windows[id];
};
module.exports = getWindowInstance;
module.exports.Windows = Windows;