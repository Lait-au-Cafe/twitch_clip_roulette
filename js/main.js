const VERSION_STRING = "0.1.1";
jQuery(document).ready(() => {
    'use strict';

    (async () => {
        //===============================================================================
        // Configurations
        //===============================================================================
        const CLIENT_ID = ""; // クライアントID
        const CLIENT_SECRET = ""; // クライアントの秘密
        const CHANNEL_ID = ""; // 自分のチャンネルID
        const COMMAND_NAME = "?so"; // コマンド名
        const DAYS = 30; // 過去何日分のクリップから選ぶか
        const CHOICE_RULE = "RANDOM"; // "RANDOM": ランダム, "MOST_POPULAR": 最多視聴回数
        const LEAST_VIEW_COUNT = 2; // 最小視聴回数
        const VIDEO_VOLUME = 0.8; // クリップの再生音量 (0~1)
        //===============================================================================

        let latest_raider_channel_id = "";
        
        // Get app access token
        const data = {
            client_id: CLIENT_ID, 
            client_secret: CLIENT_SECRET, 
            grant_type: 'client_credentials'
        };
        const data_encoded = Object.keys(data).map(key=>key+"="+encodeURIComponent(data[key])).join("&");
        const response_data = await (await fetch(
            "https://id.twitch.tv/oauth2/token", 
            {
                method: 'POST', 
                headers: {
                    'Accept': 'application/json', 
                    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
                }, 
                body: data_encoded
            })).json();
        const access_token = response_data['access_token'];

        /**
         * Twitch API function [Get Users]. 
         * @param {string} access_token - App access token. 
         * @param {string} logins - User login name. 
         */
        async function getUsers(access_token, logins) {
            return await (await fetch(
                `https://api.twitch.tv/helix/users?login=${logins}`, 
                {
                    headers: {
                        Authorization: `Bearer ${access_token}`, 
                        'Client-Id': `${CLIENT_ID}`
                    }
                })).json();
        }
        
        /**
         * Twitch API function [Get Clips]. 
         * @param {string} access_token - App access token. 
         * @param {string} broadcaster_id - ID of the broadcaster for whom clips are returned. 
         * @param {string} after - Cursor for forward pagination: tells the server where to start fetching the next set of results, in a multi-page response. 
         * @param {string} ended_at - Ending date/time for returned clips, in RFC3339 format. 
         * @param {string} started_at - Starting date/time for returned clips, in RFC3339 format. 
         */
        async function getClips(access_token, broadcaster_id, after, ended_at, started_at) {
            return await (await fetch(
                `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcaster_id}&ended_at=${ended_at}&started_at=${started_at}` + ((after !== undefined)?`&after=${after}`:""), 
                {
                    headers: {
                        Authorization: `Bearer ${access_token}`, 
                        'Client-Id': `${CLIENT_ID}`
                    }
                })).json();
        }

        /**
         * Choose a clip from a channel. 
         * @param {string} target_channel_id - The ID of the channel where it seaches for clips. 
         * @param {int} days - Searching period [days]. 
         * @param {string} choice_rule - Choice rule enforced when choosing a clip. This value has to be one of the followings: "RANDOM" for a random choice, "MOST_POPULAR" for picking up the most popular clip in the specified period. 
         * @param {int} least_view_count - The least view count the clip has to satisfy. 
         */
        async function chooseClip(target_channel_id, days, choice_rule, least_view_count=0) {
            const user = (await getUsers(access_token, target_channel_id))['data'][0];
            
            // repeat until it finds a clip which fits condition
            let chosen_clip;
            const from_date = new Date();
            for(let i=0; i<10; i++) {
                // fetch all clips in the period
                const until_date = new Date(from_date.getTime());
                from_date.setDate(until_date.getDate() - days);
                const ended_at = encodeURIComponent(until_date.toISOString());
                const started_at = encodeURIComponent(from_date.toISOString());

                let clip_candidates = [];
                let cursor = undefined;
                while(true) {
                    const api_response_clips = await getClips(access_token, user['id'], cursor, ended_at, started_at);
                    const clip_datas = api_response_clips['data'].map(({thumbnail_url, title, view_count, game_id, created_at}) => ({thumbnail_url, title, view_count, game_id, created_at}));
                    clip_candidates = clip_candidates.concat(clip_datas.filter(clip => clip['view_count'] >= least_view_count));

                    if(Object.keys(api_response_clips['pagination']).length === 0) { break; }
                    cursor = api_response_clips['pagination']['cursor'];
                }

                if(clip_candidates.length === 0) { continue; }

                switch(choice_rule) {
                    case 'RANDOM':
                        chosen_clip = clip_candidates[Math.floor(Math.random() * clip_candidates.length)];
                        break;
                    case 'MOST_POPULAR':
                        chosen_clip = clip_candidates.reduce((a, b)=>a['view_count']>b['view_count']?a:b);
                        break;
                    default:
                        console.log(`Unknown choice rule: ${choice_rule}`);
                }

                if(chosen_clip['view_count'] >= least_view_count) { break; }
            }

            return chosen_clip;
        }
        
        const client = new tmi.Client({
            channels: [CHANNEL_ID]
        });        
        client.connect();
        
        // Play clip when commands appear in chat
        client.on('chat', (channel, userstate, message, self) => {
            (async () => {
                // filter user role
                if(userstate['badges'] !== null && 'broadcaster' in userstate['badges']) {
                    const args = message.trim().split(/\s/);
                    if(args[0] === COMMAND_NAME) {
                        // if argumant is specified, use it as a raider. 
                        let raider_channel_id = latest_raider_channel_id;
                        if(args[1] !== undefined) {
                            raider_channel_id = args[1];
                        }

                        // get and set user data
                        const user = (await getUsers(access_token, raider_channel_id))['data'][0];
                        
                        // play clip
                        const clip_data = await chooseClip(raider_channel_id, DAYS, CHOICE_RULE, LEAST_VIEW_COUNT);
                        const clip_url = clip_data['thumbnail_url'].replace(/-preview.*/, '.mp4');
                        
                        $('#icon > img').attr('src', user['profile_image_url']);
                        $('#display_name').text(user['display_name']);
                        $('#user_id').text(`@${raider_channel_id}`);
                        const date = new Date(Date.parse(clip_data['created_at']));
                        $('#date').text(`${date.getFullYear()}/${date.getMonth()}/${date.getDate()}`);
                        $('#title').text(`「${clip_data['title']}」`);
                        const player = $('#player');
                        player.append(`<source src='${clip_url}'>`);
                        player.on('ended', () => {
                            $('#container').on('transitionend', () => {
                                player.empty();
                                player[0].load(); // clean up screen
                                $('#icon > img').attr('src', "");
                                $('#display_name').text("");
                                $('#user_id').text("");
                                $('#date').text("");
                                $('#title').text("");
                                $('#container').off('transitionend');
                            })
                            $('#container').addClass('hidden');
                        });
                        $('#container').removeClass('hidden');
                        player[0].volume = VIDEO_VOLUME;
                        player[0].play();
                    }
                }
            })();
        });

        // When raided, save the raider. 
        client.on("raided", (channel, username, viewers, tags) => {
            latest_raider_channel_id = tags['login'];
        });
    })();
});