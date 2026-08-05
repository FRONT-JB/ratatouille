#!/usr/bin/env python3
"""MOCK-MEETING-SCRIPT.md의 전사 정확도 채점표를 기계적으로 대조한다.

의미 판단(결정 vs 제안, Action Item 여부)은 사람이 한다. 이 스크립트는
'대본에 심어둔 문자열이 전사문에 나타났는가'만 본다.
"""
import json
import re
import sys

TARGETS = {
    "사람 이름": ["김민수", "박지영", "이한결"],
    "고유명사": ["토스페이먼츠", "나이스페이", "그라파나"],
    "영문 약어": ["QA", "PG", "SLA", "API"],
    "숫자·날짜": ["3월 2일", "3월 16일", "3월 5일", "2.8", "15일", "460만", "24시간"],
}

# 전사가 다르게 표기할 수 있는 허용 변형
VARIANTS = {
    "QA": ["QA", "큐에이", "큐 에이"],
    "PG": ["PG", "피지", "피 지"],
    "SLA": ["SLA", "에스엘에이", "에스 엘 에이"],
    "API": ["API", "에이피아이", "에이 피 아이"],
    "2.8": ["2.8", "2점 8", "이 점 팔", "2 점 8"],
    "460만": ["460만", "460", "사백육십만", "460만원"],
    "24시간": ["24시간", "24 시간", "이십사 시간"],
    "15일": ["15일", "15 일", "십오일"],
    "3월 2일": ["3월 2일", "3월2일", "삼월 이일"],
    "3월 16일": ["3월 16일", "3월16일", "삼월 십육일"],
    "3월 5일": ["3월 5일", "3월5일", "삼월 오일"],
    "그라파나": ["그라파나", "그라파냐", "Grafana", "그래파나"],
    "토스페이먼츠": ["토스페이먼츠", "토스 페이먼츠", "토스페이먼트"],
    "나이스페이": ["나이스페이", "나이스 페이", "NICE페이"],
}


def find_all(needle, segments):
    """변형 포함 검색. (히트 여부, 실제로 맞은 표기, 첫 등장 timestamp) 반환."""
    forms = VARIANTS.get(needle, [needle])
    for seg_id, ts, text in segments:
        for f in forms:
            if f in text:
                return True, f, ts, seg_id
    return False, None, None, None


def main(path):
    d = json.load(open(path))
    segments = []
    for i, s in enumerate(d["transcription"]):
        segments.append((f"seg{i:03d}", s["timestamps"]["from"][:-4], s["text"]))
    full = "".join(t for _, _, t in segments)

    print(f"세그먼트 {len(segments)} · 글자 {len(full)}\n")

    grand_ok = grand_total = 0
    for group, items in TARGETS.items():
        ok = 0
        print(f"### {group}")
        for it in items:
            hit, form, ts, sid = find_all(it, segments)
            if hit:
                ok += 1
                extra = f" (표기: {form})" if form != it else ""
                print(f"  ✅ {it:<12} {ts} {sid}{extra}")
            else:
                print(f"  ❌ {it:<12} 미검출")
        grand_ok += ok
        grand_total += len(items)
        print(f"  → {ok}/{len(items)}\n")

    print(f"## 전사 정확도 합계: {grand_ok}/{grand_total} "
          f"({grand_ok / grand_total * 100:.0f}%)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "meeting.json")
