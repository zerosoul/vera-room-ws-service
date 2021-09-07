const { GraphQLClient, gql } = require("graphql-request");

const gClient = new GraphQLClient("https://g.nicegoodthings.com/v1/graphql");
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
`;
const QUERY_ROOM = gql`
  query Room($id: String!) {
    portal_room(where: { id: { _eq: $id } }) {
      creator
      personal
      active
      id
      link
      name
      members
      windows {
        id
        title
        room
        tabs {
          title
          id
          url
          icon
        }
      }
    }
  }
`;
const WINDOW_LIST = gql`
  query Windows($room: String!) {
    portal_window(where: {room: {_eq: $room}}) {
      id
      title
      room
      created_at
      tabs {
        id
        icon
        title
        url
      }
    }
  }
`;
const NEW_ROOM = gql`
mutation NewRoom($creator: String, $host: String!, $id: String!, $link: String, $members: jsonb, $name: String){
  insert_portal_room(objects: {creator: $creator, host: $host, id: $id, link: $link, members: $members, name: $name}, on_conflict: {constraint: room_pkey, update_columns: [host,name,link]})  {
    returning {
      id
      created_at
    }
    affected_rows
  }
}
`;
const NEW_WINDOW = gql`
mutation NewRoom($room: String!, $title: String!){
  insert_portal_window(objects: {room: $room, title: $title}) {
    returning {
      id
      created_at
    }
  }
}
`;
const UPDATE_ACTIVE = gql`
  mutation UpdateActive($active: Boolean!, $id: String!) {
    update_portal_room(_set: { active: $active }, where: { id: { _eq: $id } }) {
      returning {
        active
      }
    }
  }
`;
const UPDATE_MEMBERS = gql`
  mutation UpdateMembers($id: String!, $member: jsonb) {
    update_portal_room(
      _prepend: { members: $member }
      where: { id: { _eq: $id } }
    ) {
      returning {
        members
      }
    }
  }
`;
const DELETE_TABS = gql`
  mutation DeleteTabs($wid: uuid!) {
    delete_portal_tab(where: {window: {_eq: $wid}}){
      returning {
        id
      }
    }
  }
`;
const INSERT_TABS = gql`
  mutation InsertTabs($tabs: [portal_tab_insert_input!]!) {
    insert_portal_tab(objects: $tabs){
      returning {
        id
      }
    }
  }
`;
const requestHeaders = {
  "content-type": "application/json",
  "x-hasura-admin-secret": "tristan@privoce",
};
const gRequest = (query, payload) =>
  gClient.request(query, payload, requestHeaders);

module.exports = {
  gRequest,
  QUERY_ROOM_LIST,
  WINDOW_LIST,
  QUERY_ROOM,
  UPDATE_ACTIVE,
  UPDATE_MEMBERS,
  NEW_ROOM,
  NEW_WINDOW,
  DELETE_TABS,
  INSERT_TABS
};
