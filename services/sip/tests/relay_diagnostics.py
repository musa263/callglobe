#!/usr/bin/env python3
"""Read a bounded, credential-free summary of this temporary relay's calls."""
import json
from relay_operations import ROOT, config


def summarize(record):
    variables = record.get('variables', {})
    fields = {key: value for key, value in variables.items()
              if key in ('hangup_cause', 'sip_term_status', 'read_codec', 'write_codec',
                         'rtp_use_codec_name', 'sip_hangup_disposition', 'endpoint_disposition')}
    media = {}
    for key, value in variables.items():
        if key.endswith('_sdp') and isinstance(value, str):
            media[key] = [line for line in value.splitlines()
                          if line.startswith(('m=', 'a=rtpmap:', 'a=fmtp:', 'a=ptime:'))]
    return {'callUuid': variables.get('uuid'), 'fields': fields, 'media': media}


if __name__ == '__main__':
    cfg = config(json.loads((ROOT / 'settings.json').read_text()))
    paths = sorted((ROOT / 'state/cdr').glob('*.json'), key=lambda path: path.stat().st_mtime)[-6:]
    print(json.dumps({'gateway': cfg['gateway'], 'expiresAt': cfg['expiresAt'],
                      'calls': [summarize(json.loads(path.read_text())) for path in paths]}))
