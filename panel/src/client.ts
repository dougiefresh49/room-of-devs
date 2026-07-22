/**
 * The one RoomClient per webview realm. Module singleton so components and
 * stores share it without prop-drilling; main.tsx wires stores/engine to it
 * and calls start() LAST (events are not replayed — every onEvent
 * subscription must exist before the socket opens).
 */
import { RoomClient, WsTransport } from "@room/room-client";
import { platform } from "./platform/tauri.js";

export const client = new RoomClient(new WsTransport(platform.wsUrl), {
  source: "desktop",
});
