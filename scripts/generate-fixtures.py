"""Regenerate reference fixtures using a pinned, independently implemented encoder.

Requires Python 3.9+ and internet access. Normal tests are offline and use the
checked-in JSON. The downloaded reference source stays in a temporary directory.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import urllib.request

COMMIT = "bcfe1b018cec5f1f91b5705eca5bb4cdd34e9f8d"
URL = f"https://raw.githubusercontent.com/nayuki/QR-Code-generator/{COMMIT}/python/qrcodegen.py"


def digest(values):
    return hashlib.sha256(bytes(values)).hexdigest()


def generate(reference):
    QrCode, QrSegment = reference.QrCode, reference.QrSegment
    levels = dict(zip("LMQH", [QrCode.Ecc.LOW, QrCode.Ecc.MEDIUM, QrCode.Ecc.QUARTILE, QrCode.Ecc.HIGH]))
    fixtures = {"reference": URL, "allVersions": [], "textCases": []}
    for version in range(1, 41):
        for index, (level, ecc) in enumerate(levels.items()):
            size = QrCode._get_num_data_codewords(version, ecc)
            length = size - (3 if version < 10 else 4)
            seed = version * 4 + index
            data = bytes((i * 73 + seed * 19 + i // 3) % 256 for i in range(length))
            candidates = []
            for mask in range(8):
                qr = QrCode.encode_segments([QrSegment.make_bytes(data)], ecc, version, version, mask, False)
                candidates.append({"hash": digest(int(v) for row in qr._modules for v in row), "score": qr._get_penalty_score()})
            fixtures["allVersions"].append({"version": version, "level": level, "length": length, "seed": seed, "dataCapacity": size, "candidates": candidates})

    cases = [
        ("HELLO", "byte", "M", None), ("", "byte", "L", None),
        ("0001234567890", "numeric", "Q", None), ("01234567", "numeric", "M", None),
        ("0" * 41, "numeric", "L", None), ("1" * 7089, "numeric", "L", None),
        ("HELLO WORLD", "alphanumeric", "M", None), ("A" * 4296, "alphanumeric", "L", None),
        ("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:", "alphanumeric", "Q", None),
        ("你好, world 👋", "byte", "M", None), ("café\nΚαλημέρα\nمرحبا", "byte", "H", None),
        ("  leading and trailing  ", "byte", "M", None), ("\u0000A\u0000", "byte", "L", None),
        ("a" * 255, "byte", "L", None), ("a" * 256, "byte", "L", None),
        ("a" * 2953, "byte", "L", None), ("007", "numeric", "M", 10),
        ("007", "numeric", "M", 27), ("AB", "alphanumeric", "M", 10),
        ("AB", "alphanumeric", "M", 27), ("HELLO", "byte", "M", 32),
    ]
    for text, mode, level, version in cases:
        if mode == "numeric": segments = [QrSegment.make_numeric(text)]
        elif mode == "alphanumeric": segments = [QrSegment.make_alphanumeric(text)]
        else:
            segments = [QrSegment.make_bytes(text.encode("utf-8"))]
            if any(ord(char) > 127 for char in text): segments.insert(0, QrSegment.make_eci(26))
        qr = QrCode.encode_segments(segments, levels[level], version or 1, version or 40, -1, False)
        fixtures["textCases"].append({"text": text, "mode": mode, "level": level, "forcedVersion": version, "version": qr.get_version(), "mask": qr.get_mask(), "hash": digest(int(v) for row in qr._modules for v in row), "score": qr._get_penalty_score()})
    destination = Path(__file__).resolve().parents[1] / "tests" / "reference-fixtures.json"
    destination.write_text(json.dumps(fixtures, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")
    print(f"Generated {len(fixtures['allVersions']) * 8} fixed-mask matrices and {len(cases)} automatic-mask cases.")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="qr-studio-reference-") as directory:
        source = Path(directory) / "qrcodegen.py"
        source.write_bytes(urllib.request.urlopen(URL).read())
        spec = importlib.util.spec_from_file_location("qr_reference", source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        generate(module)
