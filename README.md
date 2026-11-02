# Color Addict

A real-time browser party game for 2–8 players. One player creates a room, shares its five-character code, and everyone joins from their own device.

## Run locally

Requires Node.js 18 or newer. No npm dependencies are needed.

```sh
npm start
```

Open [http://localhost:3000](http://localhost:3000). To play from other devices on the same Wi-Fi network, open `http://<host-computer-ip>:3000` on each device.

## How to play

Each card shows a color word printed in a different color. Follow the prompt to tap either the word or the ink color. Correct answers score one point, and the first correct answer on a card earns one additional point. A wrong answer locks that player out for the card. After the host-selected number of cards, the top score wins; ties go to sudden death.

## Project layout

- `server.js` — static file server, WebSocket connections, room and game state
- `public/` — browser interface, styling, and client game logic
