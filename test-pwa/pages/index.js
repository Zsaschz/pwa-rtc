import Head from "next/head";
import styles from "../styles/Home.module.css";
import { useState, useEffect } from "react";

export default function Home() {
  // peer connection
  var pc = null;

  // data channel
  var dc = null,
    dcInterval = null;

  function createPeerConnection() {
    var config = {
      sdpSemantics: "unified-plan",
    };

    pc = new RTCPeerConnection(config);

    // connect audio / video
    pc.addEventListener("track", function (evt) {
      if (evt.track.kind == "video")
        document.getElementById("video").srcObject = evt.streams[0];
      else document.getElementById("audio").srcObject = evt.streams[0];
    });

    return pc;
  }

  function negotiate() {
    return pc
      .createOffer()
      .then(function (offer) {
        return pc.setLocalDescription(offer);
      })
      .then(function () {
        // wait for ICE gathering to complete
        return new Promise(function (resolve) {
          if (pc.iceGatheringState === "complete") {
            resolve();
          } else {
            function checkState() {
              if (pc.iceGatheringState === "complete") {
                pc.removeEventListener("icegatheringstatechange", checkState);
                resolve();
              }
            }
            pc.addEventListener("icegatheringstatechange", checkState);
          }
        });
      })
      .then(function () {
        var offer = pc.localDescription;
        var codec;

        codec = document.getElementById("audio-codec").value;
        if (codec !== "default") {
          offer.sdp = sdpFilterCodec("audio", codec, offer.sdp);
        }

        codec = document.getElementById("video-codec").value;
        if (codec !== "default") {
          offer.sdp = sdpFilterCodec("video", codec, offer.sdp);
        }

        document.getElementById("offer-sdp").textContent = offer.sdp;
        return fetch("http://localhost:8080/offer", {
          body: JSON.stringify({
            sdp: offer.sdp,
            type: offer.type,
            video_transform: document.getElementById("video-transform").value,
          }),
          headers: {
            "Content-Type": "application/json",
          },
          method: "POST",
        });
      })
      .then(function (response) {
        return response.json();
      })
      .then(function (answer) {
        return pc.setRemoteDescription(answer);
      })
      .catch(function (e) {
        console.error(e);
      });
  }

  function start() {
    pc = createPeerConnection();

    var time_start = null;

    function current_stamp() {
      if (time_start === null) {
        time_start = new Date().getTime();
        return 0;
      } else {
        return new Date().getTime() - time_start;
      }
    }

    if (document.getElementById("use-datachannel").checked) {
      var parameters = JSON.parse(
        document.getElementById("datachannel-parameters").value
      );

      dc = pc.createDataChannel("chat", parameters);
      dc.onclose = function () {
        clearInterval(dcInterval);
      };
      dc.onopen = function () {
        dcInterval = setInterval(function () {
          var message = "ping " + current_stamp();
          dc.send(message);
        }, 1000);
      };
    }

    var constraints = {
      audio: document.getElementById("use-audio").checked,
      video: false,
    };

    if (document.getElementById("use-video").checked) {
      var resolution = document.getElementById("video-resolution").value;
      if (resolution) {
        resolution = resolution.split("x");
        constraints.video = {
          width: parseInt(resolution[0], 0),
          height: parseInt(resolution[1], 0),
        };
      } else {
        constraints.video = true;
      }
    }

    if (constraints.audio || constraints.video) {
      if (constraints.video) {
        document.getElementById("media").style.display = "block";
      }
      navigator.mediaDevices.getUserMedia(constraints).then(
        function (stream) {
          stream.getTracks().forEach(function (track) {
            pc.addTrack(track, stream);
          });
          return negotiate();
        },
        function (err) {
          alert("Could not acquire media: " + err);
        }
      );
    } else {
      negotiate();
    }

    document.getElementById("stop").style.display = "inline-block";
  }

  function stop() {
    // close data channel
    if (dc) {
      dc.close();
    }

    // close transceivers
    if (pc.getTransceivers) {
      pc.getTransceivers().forEach(function (transceiver) {
        if (transceiver.stop) {
          transceiver.stop();
        }
      });
    }

    // close local audio / video
    pc.getSenders().forEach(function (sender) {
      sender.track.stop();
    });

    // close peer connection
    setTimeout(function () {
      pc.close();
    }, 500);
  }

  function sdpFilterCodec(kind, codec, realSdp) {
    var allowed = [];
    var rtxRegex = new RegExp("a=fmtp:(\\d+) apt=(\\d+)\r$");
    var codecRegex = new RegExp("a=rtpmap:([0-9]+) " + escapeRegExp(codec));
    var videoRegex = new RegExp("(m=" + kind + " .*?)( ([0-9]+))*\\s*$");

    var lines = realSdp.split("\n");

    var isKind = false;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("m=" + kind + " ")) {
        isKind = true;
      } else if (lines[i].startsWith("m=")) {
        isKind = false;
      }

      if (isKind) {
        var match = lines[i].match(codecRegex);
        if (match) {
          allowed.push(parseInt(match[1]));
        }

        match = lines[i].match(rtxRegex);
        if (match && allowed.includes(parseInt(match[2]))) {
          allowed.push(parseInt(match[1]));
        }
      }
    }

    var skipRegex = "a=(fmtp|rtcp-fb|rtpmap):([0-9]+)";
    var sdp = "";

    isKind = false;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("m=" + kind + " ")) {
        isKind = true;
      } else if (lines[i].startsWith("m=")) {
        isKind = false;
      }

      if (isKind) {
        var skipMatch = lines[i].match(skipRegex);
        if (skipMatch && !allowed.includes(parseInt(skipMatch[2]))) {
          continue;
        } else if (lines[i].match(videoRegex)) {
          sdp += lines[i].replace(videoRegex, "$1 " + allowed.join(" ")) + "\n";
        } else {
          sdp += lines[i] + "\n";
        }
      } else {
        sdp += lines[i] + "\n";
      }
    }

    return sdp;
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
  }

  return (
    <div className={styles.container}>
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        <h2>Options</h2>
        <div className="option">
          <input id="use-datachannel" checked="checked" type="checkbox" />
          <label htmlFor="use-datachannel">Use datachannel</label>
          <select id="datachannel-parameters">
            <option value='{"ordered": true}'>Ordered, reliable</option>
            <option value='{"ordered": false, "maxRetransmits": 0}'>
              Unordered, no retransmissions
            </option>
            <option value='{"ordered": false, "maxPacketLifetime": 500}'>
              Unordered, 500ms lifetime
            </option>
          </select>
        </div>
        <div className="option">
          <input id="use-audio" checked="checked" type="checkbox" />
          <label htmlFor="use-audio">Use audio</label>
          <select id="audio-codec">
            <option value="default" selected>
              Default codecs
            </option>
            <option value="opus/48000/2">Opus</option>
            <option value="PCMU/8000">PCMU</option>
            <option value="PCMA/8000">PCMA</option>
          </select>
        </div>
        <div className="option">
          <input id="use-video" type="checkbox" defaultChecked />
          <label htmlFor="use-video">Use video</label>
          <select id="video-resolution">
            <option value="" selected>
              Default resolution
            </option>
            <option value="320x240">320x240</option>
            <option value="640x480">640x480</option>
            <option value="960x540">960x540</option>
            <option value="1280x720">1280x720</option>
          </select>
          <select id="video-transform">
            <option value="none" selected>
              No transform
            </option>
            <option value="edges">Edge detection</option>
            <option value="cartoon">Cartoon effect</option>
            <option value="rotate">Rotate</option>
          </select>
          <select id="video-codec">
            <option value="default" selected>
              Default codecs
            </option>
            <option value="VP8/90000">VP8</option>
            <option value="H264/90000">H264</option>
          </select>
        </div>
        <button id="start" onClick={start}>
          Start
        </button>
        <button id="stop" style={{ display: "none" }} onClick={stop}>
          Stop
        </button>

        <div id="media" style={{ display: "none" }}>
          <h2>Media</h2>

          <audio id="audio" autoPlay></audio>
          <video id="video" autoPlay playsInline></video>
        </div>
      </main>
    </div>
  );
}
