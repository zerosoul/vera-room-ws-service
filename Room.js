const {
    gRequest,
    // QUERY_PERSONAL_ROOM,
    // QUERY_ROOM_LIST,
    QUERY_ROOM,
    UPDATE_ACTIVE,
    UPDATE_MEMBERS,
    NEW_ROOM
} = require("./graphqlClient");
const { sameUser } = require("./utils");
const Rooms = {};
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
class Room {
    constructor({ id, temp = "false", link = "" }) {
        this.id = id;
        this.temp = temp === "false" ? false : true;
        this.link = link;
        this.active = false;
        this.members = null;
        this.users = {};
        this.workspaceData = null;
        this.keepUsers = [];
    }
    get activeUsers() {
        return Object.values(this.users);
    }
    async fetchData() {
        console.log("start fetch", this.temp, typeof this.temp);
        if (this.temp) { return; }
        const result = await gRequest(QUERY_ROOM, {
            id: this.id,
        });
        console.log("data fetched", result.portal_room);
        if (result && result.portal_room[0]) {
            const [{ active, members, link }] = result.portal_room;
            this.link = link;
            this.active = active;
            this.members = members;
            // 激活当前房间
            if (!active) {
                this.setActive();
            }
        }
    }
    saveToDatabase() {
        // 写回数据库
        let roomName = this.keepUsers.map(u => u.username).join(",");
        let creator = (this.keepUsers.find(u => u.creator == true) || { username: "" }).username;
        let { id, link } = this;
        const params = { creator, host: creator, name: roomName, id, link, members: this.keepUsers };
        gRequest(NEW_ROOM, params).then((wtf) => {
            console.log(wtf);
        });
    }
    setActive() {
        console.log("active the room");
        // 设置为活跃房间
        gRequest(UPDATE_ACTIVE, { active: true, id: this.id }).then((wtf) => {
            console.log(wtf);
        });
    }
    setInactive() {
        // 设置为不活跃房间
        gRequest(UPDATE_ACTIVE, { active: false, id: this.id }).then((wtf) => {
            console.log(wtf);
        });
    }
    appendMember(member) {
        // 更新参与者
        if (!this.members) return;
        // 如果没有uid，就pass掉
        if (!member.uid) return;
        const filterd = this.members.filter((m) => sameUser(m, member));
        console.log("filterd", filterd);
        if (filterd.length == 0) {
            // append member
            console.log("append member", member);
            gRequest(UPDATE_MEMBERS, {
                member: filterMemberFields(member),
                id: this.id,
            });
        }
    }
    addActiveUser(sid, user) {
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
    updateFollow(sid, follow) {
        if (this.users[sid]) {
            this.users[sid].follow = follow;
            this.users = { ...this.users };
        }
    }
    updateActiveTab(sid, url) {
        if (this.users[sid]) {
            this.users[sid].activePage = url;
            this.users = { ...this.users };
        }
    }
    addKeepUser(sid) {
        //   该用户选择保留临时房间
        const avtiveUser = this.activeUsers.find(u => u.id == sid);
        const filterd = this.keepUsers.filter((u) => sameUser(u, avtiveUser));
        if (filterd.length == 0) {
            this.keepUsers = [...this.keepUsers, avtiveUser];
        }
    }
    removeActiveUser(sid) {
        delete this.users[sid];
        // 房间没人了
        if (this.activeUsers.length == 0) {
            console.log("nobody");
            console.log("select keep users", this.keepUsers);
            if (this.temp && this.keepUsers.length) {
                // 临时room，走一下存储逻辑
                console.log("save to db");
                this.saveToDatabase();
            } else {
                // 非临时room，设置为非活跃状态
                this.setInactive();
            }
            // 释放掉
            Rooms[this.id] = null;
        }
    }

}
const getRoomInstance = async ({ id, temp, link }) => {
    if (!Rooms[id]) {
        Rooms[id] = new Room({ id, temp, link });
    }
    await Rooms[id].fetchData();
    return Rooms[id];
};
module.exports = getRoomInstance;