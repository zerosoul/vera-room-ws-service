require('dotenv').config()
const http = require('http')
const express = require('express')
const cors = require('cors')
const socketIo = require('socket.io')
const { addUser, removeUser, getUsersInRoom } = require('./users')
const { GraphQLClient, gql } = require('graphql-request')
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
const PEER_LEAVE_EVENT = 'PEER_LEAVE_EVENT'
const gClient = new GraphQLClient('https://g.nicegoodthings.com/v1/graphql')
const QUERY_ROOM_LIST = gql`
  query RoomList {
    portal_room {
      personal
      active
      id
      name
      members
    }
  }
`
const QUERY_ROOM = gql`
  query Room($id: String!) {
    portal_room(where: { id: { _eq: $id } }) {
      personal
      active
      id
      link
      name
      members
    }
  }
`
const QUERY_PERSONAL_ROOM = gql`
  query Room($creator: String!) {
    portal_room(
      where: { creator: { _eq: $creator }, personal: { _eq: true } }
    ) {
      id
      personal
    }
  }
`
const UPDATE_ACTIVE = gql`
  mutation UpdateActive($active: Boolean!, $id: String!) {
    update_portal_room(_set: { active: $active }, where: { id: { _eq: $id } }) {
      returning {
        connect_id
        active
      }
    }
  }
`
const UPDATE_MEMBERS = gql`
  mutation UpdateMembers($id: String!, $member: jsonb) {
    update_portal_room(
      _prepend: { members: $member }
      where: { id: { _eq: $id } }
    ) {
      returning {
        connect_id
        members
      }
    }
  }
`
const requestHeaders = {
  'content-type': 'application/json',
  'x-hasura-admin-secret': 'tristan@privoce',
}
function shallowEqual(object1, object2) {
  const keys1 = Object.keys(object1)
  const keys2 = Object.keys(object2)

  if (keys1.length !== keys2.length) {
    return false
  }

  for (let key of keys1) {
    if (object1[key] !== object2[key]) {
      return false
    }
  }

  return true
}
io.on('connection', (socket) => {
  console.log(`${socket.id} connected`)
  // Join a room
  const { roomId, peerId, ...userInfo } = socket.handshake.query
  socket.join(roomId)

  // Overrides the clients headers with the passed values
  gClient
    .request(
      QUERY_ROOM,
      {
        id: roomId,
      },
      requestHeaders,
    )
    .then(async ({ portal_room }) => {
      console.log({ portal_room })
      if (portal_room && portal_room[0]) {
        let [{ active, id, members }] = portal_room
        if (!active) {
          // 设置 room 在线
          gClient
            .request(UPDATE_ACTIVE, { active: true, id }, requestHeaders)
            .then((wtf) => {
              console.log(wtf)
            })
        }
        let member = {
          id: userInfo.uid,
          photo: userInfo.avator,
          username: userInfo.name,
        }
        let filterd = (members || []).filter((m) => {
          return shallowEqual(m, member)
        })
        console.log('filterd', filterd)
        if (filterd.length == 0) {
          // append member
          gClient.request(
            UPDATE_MEMBERS,
            {
              member,
              id,
            },
            requestHeaders,
          )
        }
      }
    })
  // 当前用户列表
  let currentRoomUsers = getUsersInRoom(roomId)
  console.log('current user list', roomId, currentRoomUsers)
  socket.emit(CURRENT_PEERS, currentRoomUsers)

  // add user
  let currUser = addUser(socket.id, roomId, { peerId, ...userInfo })
  // 向房间内其它人广播新加入的用户
  socket.broadcast.in(roomId).emit(PEER_JOIN_EVENT, currUser)
  // Leave the room if the user closes the socket
  socket.on('disconnect', () => {
    removeUser(socket.id)
    io.in(roomId).emit(PEER_LEAVE_EVENT, currUser)
    socket.leave(roomId)
    let currUsers = getUsersInRoom(roomId)
    if (currUsers.length == 0) {
      // 房间没人了
      gClient
        .request(UPDATE_ACTIVE, { active: false, id: roomId }, requestHeaders)
        .then((wtf) => {
          console.log(wtf)
        })
    }
  })
})

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`)
})

app.get('/rooms/:roomId/users', (req, res) => {
  const users = getUsersInRoom(req.params.roomId)
  return res.json({ users })
})
app.get('/members/authing/:username', async (req, res) => {
  console.log('rrrr')
  let { username } = req.params
  if (!username) return res.json(null)
  let result = await gClient.request(QUERY_ROOM_LIST, {}, requestHeaders)
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
    let result = await gClient.request(
      QUERY_PERSONAL_ROOM,
      {
        creator,
      },
      requestHeaders,
    )
    room = result.portal_room[0] || null
  }
  return res.json({ room })
})
