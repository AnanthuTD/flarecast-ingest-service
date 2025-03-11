import NodeMediaServer from "node-media-server";

const config = {
	rtmp: {
		port: 1935,
		chunk_size: 60000,
		gop_cache: true,
		ping: 30,
		ping_timeout: 60,
	},
	http: {
		port: 8000,
		mediaroot: "./media",
		allow_origin: "*",
	},
	trans: {
		ffmpeg:
			"C:\\Users\\anant\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe",
		tasks: [
			{
				app: "game",
				// vc: "copy",
				// ac: "copy",
				hls: true,
				hlsFlags: "[hls_time=2:hls_list_size=0:hls_flags=delete_segments]",
				hlsKeep: true,
			},
		],
	},
	fission: {
		ffmpeg:
			"C:\\Users\\anant\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe",
		tasks: [
			{
				rule: "game/*",
				model: [
					{
						ab: "128k",
						vb: "1500k",
						vs: "1280x720",
						vf: "30",
					},
					{
						ab: "96k",
						vb: "1000k",
						vs: "854x480",
						vf: "24",
					},
					{
						ab: "96k",
						vb: "600k",
						vs: "640x360",
						vf: "20",
					},
				],
			},
		],
	},
};

var nms = new NodeMediaServer(config);
nms.run();
