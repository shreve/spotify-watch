//
//  SpotifyAuth
//
//  Automate fetching an OAuth token from Spotify.
//
import os from "os";
import fs from "fs";
import path from "path";
import open from "open";
import http from "http";
import sleep from "sleep-promise";
import SpotifyWebApi from "spotify-web-api-node";
const credsFile = "~/.cache/spotify/credentials.json".replace("~", os.homedir);
const redirectUri = "http://localhost:8888/callback";
function generateRandomString(length) {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
export default class SpotifyAuth {
    api;
    creds;
    clientId;
    clientSecret;
    constructor(clientId, clientSecret) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.api = new SpotifyWebApi({
            clientId: this.clientId,
            clientSecret: this.clientSecret,
            redirectUri,
        });
        if (!fs.existsSync(credsFile)) {
            const parent = path.dirname(credsFile);
            console.log("Creating directory: ", parent);
            fs.mkdirSync(parent, { recursive: true });
            fs.openSync(credsFile, "w");
        }
    }
    async init() {
        // Try to load cached credentials from disk
        let creds = this.load();
        // If we don't have any, try to fetch new tokens
        if (!creds) {
            await this.grantAccessToken();
            creds = this.load();
        }
        // If it looks like this token has expired, refresh it.
        if (new Date(Date.parse(creds.expires_at)) < new Date()) {
            await this.refreshAccessToken();
            creds = this.load();
        }
        return creds;
    }
    load() {
        const data = fs.readFileSync(credsFile, "utf8");
        try {
            const result = JSON.parse(data);
            if (result && result.access_token) {
                // If we've loaded the tokens off disk, set them in the api client too
                this.creds = result;
                this.api.setAccessToken(result.access_token);
                this.api.setRefreshToken(result.refresh_token);
                return result;
            }
        }
        catch (err) { }
        return null;
    }
    async grantAccessToken() {
        console.log("grantAccessToken()");
        const state = generateRandomString(16);
        // your application requests authorization
        const scopes = [
            "user-read-playback-state",
            "user-read-currently-playing",
            "user-read-email",
            "user-read-private",
            "playlist-modify-private",
            "playlist-read-private",
        ];
        const authorizeURL = this.api.createAuthorizeURL(scopes, state);
        let completed = false;
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://${req.headers.host}`);
            if (url.pathname != "/callback") {
                return;
            }
            const auth_code = url.searchParams.get("code");
            this.api
                .authorizationCodeGrant(auth_code)
                .then((data) => {
                this._setTokens(data.body);
                server.close();
                res.write(JSON.stringify({ status: "ok" }));
                res.end();
            })
                .catch((err) => {
                console.error("ERROR", "authorizationCodeGrant(", auth_code, ")", err);
            });
        });
        server.listen(8888, () => {
            console.log("Server listening on :8888");
        });
        open(authorizeURL);
        while (server.listening) {
            await sleep(500);
        }
        console.log("Server has finished");
    }
    async refreshAccessToken() {
        console.log("Refreshing access token");
        await this.api
            .refreshAccessToken()
            .then((data) => {
            this._setTokens(data.body);
        })
            .catch((err) => {
            console.error("ERROR", "refreshAccessToken()", err);
        });
    }
    _setTokens(data) {
        console.log("Setting tokens: ", data);
        this.api.setAccessToken(data.access_token);
        this.api.setRefreshToken(data.refresh_token);
        data.expires_at = new Date(new Date().getTime() + data.expires_in * 1000);
        fs.writeFileSync(credsFile, JSON.stringify(data, null, 4));
    }
}
