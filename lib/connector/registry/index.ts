import { AI_ACTIONS } from "../actions/ai";
import { BOARD_ACTIONS } from "../actions/boards";
import { EVENT_DEFINITIONS } from "../events/definitions";
import { READ_RESOURCES } from "../resources/boards";
import type { Registry } from "./define";

/**
 * Everything the connector can do. The manifest, the OpenAPI document and the request handlers all read these
 * lists, so adding an action, a resource or an event here is the only step needed to expose it.
 */
export const registry: Registry = {
  actions: [...BOARD_ACTIONS, ...AI_ACTIONS],
  resources: [...READ_RESOURCES],
  events: [...EVENT_DEFINITIONS],
};

export const findAction = (name: string) => registry.actions.find((a) => a.name === name);
