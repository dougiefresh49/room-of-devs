/**
 * The one RoomClient for the mobile SPA. Module singleton so components
 * share it without prop-drilling; main.tsx wires subscriptions and calls
 * start() LAST (events are not replayed — every subscription must exist
 * before the EventSource opens).
 */
import { RoomClient, SseTransport } from "@room/room-client";

export const client = new RoomClient(new SseTransport(), {
  source: "mobile",
});
