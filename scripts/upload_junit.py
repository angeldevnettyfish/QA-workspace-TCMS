"""Upload JUnit results and an optional self-contained HTML report (Python 3)."""
import argparse
import glob
import os
import secrets
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reports', nargs='+', help='JUnit file paths or glob patterns')
    parser.add_argument('--html', help='Self-contained HTML report path (maximum 10 MB)')
    args = parser.parse_args()
    paths = sorted({path for pattern in args.reports for path in glob.glob(pattern, recursive=True) if os.path.isfile(path)})
    if not paths:
        raise SystemExit('No JUnit reports found; check the report path and test command.')
    root = ET.Element('testsuites')
    total = 0
    for path in paths:
        total += os.path.getsize(path)
        if total > 5_000_000:
            raise SystemExit('JUnit reports exceed the 5 MB upload limit.')
        with open(path, 'rb') as source:
            raw = source.read()
        if b'<!DOCTYPE' in raw.upper() or b'<!ENTITY' in raw.upper():
            raise SystemExit('JUnit DTDs/entities are not supported.')
        report = ET.fromstring(raw)
        if report.tag.split('}')[-1] == 'testsuite':
            root.append(report)
        elif report.tag.split('}')[-1] == 'testsuites':
            root.extend(list(report))
        else:
            raise SystemExit('Expected a JUnit testsuite/testsuites document.')
    xml = ET.tostring(root, encoding='utf-8', xml_declaration=True)
    if len(xml) > 5_000_000:
        raise SystemExit('Merged JUnit report exceeds the 5 MB upload limit.')
    boundary = secrets.token_hex(24)
    body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="bitbucket-junit.xml"\r\n'
            'Content-Type: application/xml\r\n\r\n').encode() + xml + b'\r\n'
    if args.html:
        if not os.path.isfile(args.html):
            raise SystemExit('HTML report not found; check the --html path.')
        if os.path.getsize(args.html) > 10_000_000:
            raise SystemExit('HTML report exceeds the 10 MB upload limit.')
        with open(args.html, 'rb') as source:
            html = source.read(10_000_001)
        if len(html) > 10_000_000 or not html.strip():
            raise SystemExit('HTML report must be nonempty and at most 10 MB.')
        body += (f'--{boundary}\r\nContent-Disposition: form-data; name="html_report"; filename="report.html"\r\n'
                 'Content-Type: text/html\r\n\r\n').encode() + html + b'\r\n'
    body += f'--{boundary}--\r\n'.encode()
    request = urllib.request.Request(os.environ['QA_CALLBACK_URL'], data=body, headers={
        'Authorization': 'Bearer ' + os.environ['QA_CALLBACK_TOKEN'],
        'Content-Type': f'multipart/form-data; boundary={boundary}',
    })
    class NoRedirects(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    for attempt in range(3):
        try:
            with urllib.request.build_opener(NoRedirects()).open(request, timeout=30) as response:
                print('JUnit' + (' and HTML' if args.html else '') + ' report uploaded successfully for run', os.environ.get('QA_RUN_ID', ''))
                return
        except urllib.error.HTTPError as exc:
            if exc.code < 500:
                raise SystemExit(f'Report upload rejected (HTTP {exc.code}); check the run token and JUnit file.') from None
        except (urllib.error.URLError, TimeoutError):
            pass
        if attempt < 2:
            time.sleep(2)
    raise SystemExit('Report upload failed; check connectivity from this runner to QA_PUBLIC_URL.')


if __name__ == '__main__':
    main()
