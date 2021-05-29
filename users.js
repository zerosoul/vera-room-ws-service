const users = []

const addUser = (id, room, userInfo = { name: 'Guest', avator: '' }) => {
  const { name } = userInfo
  // const existingUser = users.find(
  //   (user) => user.room === room && user.name === name,
  // )
  const existingUser = false

  if (!name || !room) return { error: 'Username and room are required.' }
  if (existingUser) return { error: 'Username is taken.' }

  const user = { id, room, ...userInfo }
  console.log('add user', user)
  users.push(user)

  return { id, room, ...userInfo }
}

const removeUser = (id) => {
  const index = users.findIndex((user) => user.id === id)

  if (index !== -1) return users.splice(index, 1)[0]
}

const getUser = (id) => users.find((user) => user.id === id)

const getUsersInRoom = (room) => users.filter((user) => user.room === room)

module.exports = { addUser, removeUser, getUser, getUsersInRoom }
