function shallowEqual(object1, object2) {
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (object1[key] !== object2[key]) {
      return false;
    }
  }

  return true;
}
function sameUser(u1, u2) {
  // let compareKeys = ["uid", "username", "photo"];
  //只比较uid是否一致
  let compareKeys = ["uid"];
  for (let key of compareKeys) {
    if (u1[key] !== u2[key]) {
      return false;
    }
  }
  return true;
}
module.exports = { shallowEqual, sameUser };
