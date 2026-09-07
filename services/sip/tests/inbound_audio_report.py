"""Read-only call audio evidence. No raw SIP headers, transcripts, or secrets."""
import json
import re
import subprocess
import sys


def run(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=30)
        if result.returncode:
            print("unavailable:", args[:2], result.returncode)
        return result.stdout + result.stderr
    except (OSError, subprocess.TimeoutExpired):
        print("unavailable:", args[:2])
        return ""


def redact(line):
    line = re.sub(r"gencred[A-Za-z0-9]+", "[sip-user]", line)
    line = re.sub(r"(?<![a-zA-Z0-9])\+?\d{10,32}(?![a-zA-Z0-9])", "[number/id]", line)
    return line[:700]


def main():
    call = sys.argv[1] if len(sys.argv) == 2 else ""
    if not re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", call):
        raise SystemExit("A FreeSWITCH channel UUID is required.")
    print("Channel:", call)
    print("Container state")
    for name in ["sip-freeswitch-1", "sip-rtpengine-1", "vocivo-receptionist", "vocivo-tts"]:
        print(name, run(["docker", "inspect", "--format", "{{.Config.Image}} {{.Created}} {{.State.Status}}", name]).strip())
    print("Receptionist stages (last 2 hours; silence polling excluded)")
    logs = run(["docker", "logs", "--since", "2h", "--tail", "20000", "vocivo-receptionist"])
    lines = [line for line in logs.splitlines() if call[:8] in line and "nothing yet" not in line]
    for line in lines[-80:]:
        print(redact(line))
    print("FreeSWITCH call/audio events (last 20000 log lines)")
    fs = run(["docker", "exec", "sip-freeswitch-1", "tail", "-n", "20000", "/var/log/freeswitch/freeswitch.log"])
    selected = [line for line in fs.splitlines() if call in line]
    paths = set()
    for line in selected:
        paths.update(re.findall(r"/var/lib/vocivo-receptionist/prompts/[a-f0-9]{32,64}\.wav", line))
        if re.search(r"playback|Audio|RTP|rtp|Codec|codec|SDP|socket|Hangup|New Channel|xml_curl|File|ERR\]|CRIT\]|displace", line) and not re.search(r"Authorization|secret|sip_auth|api_key|execute-app-arg.*text", line, re.I):
            print(redact(line))
    print("SDP media fields from this channel (keys/identities excluded)")
    in_sdp = False
    for line in fs.splitlines():
        if re.match(r"^[a-f0-9]{8}-", line):
            in_sdp = call in line and "SDP" in line
        elif in_sdp and re.match(r"^(c=|m=|a=rtpmap:|a=sendrecv|a=sendonly|a=recvonly|a=inactive)", line.strip()):
            print(line.strip())
    print("Playback asset checks (PCM statistics only)")
    # Read the exact files referenced by this call, within the shared prompt
    # volume. Never read arbitrary paths or output caller audio/transcripts.
    check = """import array,json,math,sys,wave
for path in json.loads(sys.argv[1]):
    try:
        with wave.open(path, 'rb') as f:
            rate,channels,width,frames=f.getframerate(),f.getnchannels(),f.getsampwidth(),f.getnframes()
            data=f.readframes(frames)
        pcm=array.array('h',data) if width==2 else []
        if sys.byteorder!='little': pcm.byteswap()
        rms=round(math.sqrt(sum(x*x for x in pcm)/len(pcm)),1) if pcm else 0
        print(json.dumps(dict(asset=path.rsplit('/',1)[-1],rate=rate,channels=channels,width=width,frames=frames,bytes=len(data),rms=rms)))
    except Exception as e: print(path.rsplit('/',1)[-1],type(e).__name__)
"""
    if paths:
        print(run(["docker", "exec", "vocivo-receptionist", "python", "-c", check, json.dumps(sorted(paths)[:12])]))
        for path in sorted(paths)[:12]:
            print(run(["docker", "exec", "sip-freeswitch-1", "stat", "-c", "%n %s bytes", path]).strip())
    else:
        print("No prompt paths found in retained call log.")
    print("RTP engine errors (last 2 hours, counts only)")
    rtp = run(["docker", "logs", "--since", "2h", "--tail", "20000", "sip-rtpengine-1"])
    print({key: rtp.lower().count(key) for key in ["error", "timeout", "unknown flag", "failed", "port"]})
    print("Historical logs and PCM assets do not prove audio reached the caller.")


if __name__ == "__main__":
    main()
