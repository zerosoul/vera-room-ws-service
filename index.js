require('dotenv').config()
const http = require('http')
const express = require('express')
const cors = require('cors')
const socketIo = require('socket.io')
const { addUser, removeUser, getUsersInRoom } = require('./users')
const { shallowEqual } = require('./utils')
const {
  gRequest,
  QUERY_PERSONAL_ROOM,
  QUERY_ROOM_LIST,
  QUERY_ROOM,
  UPDATE_ACTIVE,
  UPDATE_MEMBERS,
} = require('./graphqlClient')
const { ManagementClient } = require('authing-js-sdk')
const managementClient = new ManagementClient({
  userPoolId: '6034a31382f5d09e3b5a15fa',
  secret: process.env.AUTHING_SECRET,
})
const app = express()
app.use(cors())
const server = http.createServer(app)
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    credentials: true,
  },
})

const PORT = 4000
const CURRENT_PEERS = 'CURRENT_PEERS_EVENT'
const PEER_JOIN_EVENT = 'PEER_JOIN_EVENT'
// const USERNAME_UPDATE_EVENT = 'USERNAME_UPDATE_EVENT'
// const SOMEONE_INFO_UPDATE = 'SOMEONE_INFO_UPDATE'
const PEER_LEAVE_EVENT = 'PEER_LEAVE_EVENT'

io.on('connection', (socket) => {
  console.log(`${socket.id} connected`)
  // Join a room
  const { roomId, peerId, ...userInfo } = socket.handshake.query
  socket.join(roomId)

  // Overrides the clients headers with the passed values
  gRequest(QUERY_ROOM, {
    id: roomId,
  }).then(async ({ portal_room }) => {
    console.log({ portal_room })
    if (portal_room && portal_room[0]) {
      let [{ active, id, members }] = portal_room
      if (!active) {
        // 设置 room 在线
        gRequest(UPDATE_ACTIVE, { active: true, id }).then((wtf) => {
          console.log(wtf)
        })
      }
      let member = {
        id: userInfo.uid,
        photo: userInfo.avator,
        username: userInfo.username,
      }
      let filterd = (members || []).filter((m) => {
        return shallowEqual(m, member)
      })
      console.log('filterd', filterd)
      if (filterd.length == 0) {
        // append member
        gRequest(UPDATE_MEMBERS, {
          member,
          id,
        })
      }
    }
  })
  // 当前用户列表
  let currentRoomUsers = getUsersInRoom(roomId)
  let currUser = { peerId, ...userInfo }
  console.log('current user list', roomId, currentRoomUsers)
  // 第一个进来的，初始化房间人数为1
  let host = false
  if (currentRoomUsers.length == 0) {
    host = true
    addUser(socket.id, roomId, currUser)
    // 现在人数为1了
    currentRoomUsers = getUsersInRoom(roomId)
  }
  socket.emit(CURRENT_PEERS, { users: currentRoomUsers, host })

  // new user
  socket.on('message', (data) => {
    console.log(data)
    const { cmd = 'NEW_PEER', payload = null } = data
    switch (cmd) {
      case 'NEW_PEER':
        // add user
        let newUser = addUser(socket.id, roomId, currUser)
        // 向房间内其它人广播新加入的用户
        socket.broadcast.in(roomId).emit(PEER_JOIN_EVENT, newUser)
        // 更新自己的
        let newUsers = getUsersInRoom(roomId)
        socket.emit(CURRENT_PEERS, { users: newUsers, update: true })
        break

      default:
        break
    }
  })
  // Leave the room if the user closes the socket
  socket.on('disconnect', () => {
    removeUser(socket.id)
    io.in(roomId).emit(PEER_LEAVE_EVENT, currUser)
    socket.leave(roomId)
    let currUsers = getUsersInRoom(roomId)
    // 房间没人了
    if (currUsers.length == 0) {
      gRequest(UPDATE_ACTIVE, { active: false, id: roomId }).then((wtf) => {
        console.log(wtf)
      })
    }
  })
})

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})
// APIs
app.get('/rooms/:roomId/users', (req, res) => {
  const users = getUsersInRoom(req.params.roomId)
  return res.json({ users })
})
app.get('/members/authing/:username', async (req, res) => {
  console.log('rrrr')
  let { username } = req.params
  if (!username) return res.json(null)
  let result = await gRequest(QUERY_ROOM_LIST, {})
  let rooms = result?.portal_room
  const seen = new Set()
  let users = rooms
    .filter((r) => {
      return (
        r.host == username ||
        (r.members && r.members.some((m) => m.username == username))
      )
    })
    .map((room) => room.members)
    .flat()
    .filter((m) => {
      if (!m.id || m.username == username) return false
      const duplicate = seen.has(m.id)
      seen.add(m.id)
      return !duplicate
    })
  let udfs = await managementClient.users.getUdfValueBatch(
    users.map((u) => u.id),
  )

  console.log({ result, users })
  return res.json({
    data: users.map((u) => {
      return { ...u, traceId: udfs[u.id].notification || '' }
    }),
  })
})
app.get('/room/:creator', async (req, res) => {
  let { creator } = req.params
  let room = null
  if (creator) {
    let result = await gRequest(QUERY_PERSONAL_ROOM, {
      creator,
    })
    room = result.portal_room[0] || null
  }
  return res.json({ room })
})
