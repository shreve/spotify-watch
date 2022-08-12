//
//  SpotifyWatcher
//
//  Collect callbacks and run the main watch loop looking for events to
//  trigger them.
//

import sleep from "sleep-promise";

import SpotifyAuth from "./auth.js";

class SpotifyEvent {
  name: string;
  data: any;
  constructor(name, data) {
    this.name = name;
    this.data = data;
  }
}

const DEFAULT_TICK = 500; // ms
const TICK_EVENT = new SpotifyEvent("tick", {});

type config = {
  tick: number;
};

type state = {
  isPlaying: boolean;
  item?: { uri: string };
  device?: {};
};

type callback_list = {
  start?: Function;
  tick?: Function;
  listen?: Function;
};

async function maybeAsync(maybePromise: Promise<any> | any): Promise<any> {
  if (maybePromise instanceof Promise) {
    return await maybePromise.catch((err) => {
      console.error("ERROR", err);
      return null;
    });
  }
  return maybePromise;
}

export default class SpotifyWatcher {
  config: config;
  state: state | null;
  callbacks: callback_list;
  auth: SpotifyAuth;
  running: boolean = false;

  constructor(clientId, clientSecret) {
    this.auth = new SpotifyAuth(clientId, clientSecret);

    this.config = { tick: DEFAULT_TICK };
    this.callbacks = {};
    this.state = null;
  }

  on(event: string, callback: Function): void {
    this.callbacks[event] = callback;
  }

  async watch(): Promise<void> {
    // Set up the API / auth
    await this.auth.init();

    // Immediately trigger this event.
    if (this.callbacks.hasOwnProperty("start")) {
      let res = await maybeAsync(
        this.callbacks["start"]({ api: this.auth.api })
      );
    }

    this.running = true;
    while (this.running) {
      // First, wait the tick amount of time
      await sleep(this.config.tick || DEFAULT_TICK);

      // Ask for any of the events that we're watching for
      let events = await this.tick();

      // And if there are any, call the callbacks!
      for (let event of events) {
        let args = { api: this.auth.api, ...event.data };
        let result = await maybeAsync(this.callbacks[event.name](args));
      }
    }
  }

  async tick(): Promise<SpotifyEvent[]> {
    let events: SpotifyEvent[] = [];
    let newState: state;

    if ("tick" in this.callbacks) {
      events.push(TICK_EVENT);
    }

    if ("listen" in this.callbacks) {
      newState = await this.currentState();

      if (newState && this.shouldTriggerListen(newState)) {
        events.push(
          new SpotifyEvent("listen", {
            item: newState.item,
            device: newState.device,
          })
        );
      }
    }

    this.state = { ...this.state, ...newState };

    return events;
  }

  private shouldTriggerListen(newState: state): boolean {
    // We can't listen if we're not playing.
    if (!newState.isPlaying) {
      return false;
    }

    // If we don't have an item, we can't listen.
    if (newState.item == null) {
      return false;
    }

    // If we just started or were previously playing, listen.
    if (!this.state || !this.state.isPlaying) {
      return true;
    }

    // Only trigger once per track.
    if (newState.item.uri !== this.state.item.uri) {
      return true;
    }

    return false;
  }

  async currentState(): Promise<state | null> {
    let newState: state = <state>{};
    let gotStatus = await this.auth.api
      .getMyCurrentPlaybackState()
      .then((data) => {
        // No content. Nothing happening.
        if (data.statusCode == 204) {
          newState = <state>{
            isPlaying: false,
          };
        }

        // Good response, read only what we want.
        if (data.statusCode == 200) {
          newState = <state>{
            isPlaying: data.body.is_playing,
            item: data.body.item,
            device: data.body.device,
          };
        }

        return true;
      })
      .catch((err) => {
        return false;
      });

    if (gotStatus) {
      return newState;
    }
  }
}
