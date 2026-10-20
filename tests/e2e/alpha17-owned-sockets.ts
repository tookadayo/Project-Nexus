import type { Socket } from "node:net";

/** Register each owned socket once, including sockets reused by keep-alive. */
export function trackOwnedSocket(sockets: Set<Socket>, socket: Socket): Socket {
  if (!sockets.has(socket)) {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  }
  return socket;
}
