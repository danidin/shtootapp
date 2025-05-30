import { gql } from 'apollo-server-express';

export const typeDefs = gql`
  type User {
    ID: ID!
    email: String!
    displayName: String!
  }

  type Shtoot {
    ID: ID!
    userID: ID!
    text: String!
    timestamp: Float
  }

  type Service {
    ID: ID!
    pathToContract: String!
  }

  type Query {
    users: [User!]!
    user(ID: ID!): User
    shtoots: [Shtoot!]!
    shtoot(ID: ID!): Shtoot
    services: [Service!]!
    service(ID: ID!): Service
  }

  type Mutation {
    createUser(email: String!, displayName: String!): User!
    createShtoot(userID: ID!, text: String!): Shtoot!
    createService(pathToContract: String!): Service!
  }

  type Subscription {
    shtootAdded: Shtoot!
  }
`;
