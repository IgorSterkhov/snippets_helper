from api.routes.media import HTML_RESPONSE_CSP
from api.routes.share_links import PUBLIC_SHARE_HEADERS


def test_public_html_asset_csp_blocks_network_and_external_frames():
    assert "sandbox allow-scripts" in HTML_RESPONSE_CSP
    assert "default-src 'none'" in HTML_RESPONSE_CSP
    assert "connect-src 'none'" in HTML_RESPONSE_CSP
    assert "frame-src 'none'" in HTML_RESPONSE_CSP
    assert "worker-src 'none'" in HTML_RESPONSE_CSP
    assert "object-src 'none'" in HTML_RESPONSE_CSP
    assert "base-uri 'none'" in HTML_RESPONSE_CSP
    assert "form-action 'none'" in HTML_RESPONSE_CSP


def test_public_share_parent_csp_limits_iframe_sources():
    csp = PUBLIC_SHARE_HEADERS["Content-Security-Policy"]
    assert "frame-src 'self'" in csp
    assert "https://ister-app.ru" in csp
    assert "connect-src 'none'" in csp
    assert "object-src 'none'" in csp
    assert PUBLIC_SHARE_HEADERS["X-Content-Type-Options"] == "nosniff"
