/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as billing from "../billing.js";
import type * as commentLogic from "../commentLogic.js";
import type * as comments from "../comments.js";
import type * as crons from "../crons.js";
import type * as elements from "../elements.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as maintenance from "../maintenance.js";
import type * as presence from "../presence.js";
import type * as profile from "../profile.js";
import type * as shards from "../shards.js";
import type * as slates from "../slates.js";
import type * as snapshot from "../snapshot.js";
import type * as usage from "../usage.js";
import type * as users from "../users.js";
import type * as versions from "../versions.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  billing: typeof billing;
  commentLogic: typeof commentLogic;
  comments: typeof comments;
  crons: typeof crons;
  elements: typeof elements;
  files: typeof files;
  http: typeof http;
  maintenance: typeof maintenance;
  presence: typeof presence;
  profile: typeof profile;
  shards: typeof shards;
  slates: typeof slates;
  snapshot: typeof snapshot;
  usage: typeof usage;
  users: typeof users;
  versions: typeof versions;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
