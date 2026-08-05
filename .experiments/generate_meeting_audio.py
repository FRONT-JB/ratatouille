#!/usr/bin/env python3
"""MOCK-MEETING-SCRIPT.md를 바탕으로 3인 모의 회의 MP3를 만든다."""

from __future__ import annotations

import csv
import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "회의음성.mp3"
TIMELINE = ROOT / ".experiments" / "회의음성-타임라인.tsv"
TOTAL_DURATION = 600.0


@dataclass(frozen=True)
class Speaker:
    name: str
    voice: str
    rate: int
    pan: float
    volume: float


@dataclass(frozen=True)
class Cue:
    speaker: str
    text: str
    gap_after: float = 0.9
    overlap: float = 0.0


@dataclass(frozen=True)
class Section:
    start: float
    end: float
    topic: str
    cues: tuple[Cue, ...]


SPEAKERS = {
    "민수": Speaker("김민수", "Reed (한국어(대한민국))", 178, -0.20, 0.96),
    "지영": Speaker("박지영", "Yuna", 181, 0.18, 1.00),
    "한결": Speaker("이한결", "Eddy (한국어(대한민국))", 175, 0.02, 0.92),
}


SECTIONS = (
    Section(
        0.0,
        60.0,
        "근황과 잡담",
        (
            Cue("민수", "어, 다들 들어오셨죠? 안녕하세요. 김민수입니다. 박지영 씨, 이한결 씨, 소리 괜찮으세요?"),
            Cue("지영", "네, 잘 들려요. 안녕하세요, 박지영입니다. 제 쪽은 괜찮습니다."),
            Cue("한결", "저도 잘 들립니다. 안녕하세요, 이한결입니다. 잠깐 이어폰만 좀 정리할게요."),
            Cue("민수", "좋습니다. 오늘 바깥이 갑자기 쌀쌀해졌던데, 출근할 때 괜찮으셨어요?"),
            Cue("지영", "아, 저는 커피 사러 나갔다가 생각보다 추워서 바로 들어왔어요. 오후에는 좀 풀린다던데요."),
            Cue("한결", "저는 엘리베이터가 한 층마다 서는 바람에 살짝 늦었습니다. 그래도 정각에는 들어왔네요."),
            Cue("민수", "하하, 네. 주말은 다들 좀 쉬셨어요? 저는 집 정리한다고 해놓고 거의 못 했어요."),
            Cue("지영", "저도 비슷했어요. 그래도 라따뚜이 화면을 휴대폰으로 잠깐 봤는데 생각보다 잘 나와서 마음은 좀 놓였고요."),
            Cue("한결", "그 화면은 글자 간격을 조금만 더 보면 될 것 같아요. 오늘 안건이랑은 별개니까 나중에 짧게 공유할게요."),
            Cue("민수", "좋아요. 그럼 잡담은 여기까지 하고, 오늘은 결제 모듈 진행 상황부터 보겠습니다.", gap_after=1.2),
        ),
    ),
    Section(
        60.0,
        180.0,
        "결제 모듈 진행 상황",
        (
            Cue("민수", "지영 씨, 지난주 기준으로 결제 모듈 에이피아이 연결 상태가 어느 정도인지 먼저 말씀해주시겠어요?"),
            Cue("지영", "네. 기본 승인하고 취소 에이피아이는 붙었는데요, 부분 취소랑 실패 콜백에서 예외가 조금 남아 있어요."),
            Cue("민수", "실패 콜백이면 주문 상태가 결제 대기에서 멈추는 그 건 말씀하시는 거죠?"),
            Cue("지영", "맞아요. 재시도할 때 같은 요청이 두 번 들어오면 중복 처리가 될 수 있어서, 그 부분을 막는 테스트를 하고 있습니다."),
            Cue("한결", "화면에서는 결제 중 표시가 너무 오래 남는 경우가 있더라고요. 사용자가 새로고침해야 하나 헷갈릴 수 있어요."),
            Cue("민수", "음, 그러면 서버 처리뿐 아니라 실패 안내 문구도 같이 확인해야겠네요. 지금 일정에 영향이 꽤 있겠어요."),
            Cue("지영", "네, 그리고 로그 정리는 지난주에 끝냈어요. 이제 로그 형식 자체를 다시 손댈 일은 없을 것 같습니다."),
            Cue("민수", "좋습니다. 로그 정리는 완료된 걸로만 기록할게요. 새로 할 일은 아니고요."),
            Cue("한결", "모바일 결제 창도 확인했는데 작은 화면에서 버튼이 한 줄 내려가는 문제가 하나 더 있습니다."),
            Cue("지영", "그건 결제사 창에서 내려주는 영역이라 저희가 바로 고치긴 어렵고, 우회할 수 있는지 보고 있어요."),
            Cue("민수", "결제 모듈 오픈이 원래 삼월 이일이었는데, 이 상태로는 무리인 것 같아요. 이 주 미뤄서 삼월 십육일로 가는 게 어떨까요?", gap_after=5.0),
            Cue("지영", "네, 저도 그게 맞다고 봐요. 그렇게 가시죠."),
            Cue("한결", "동의합니다."),
            Cue("민수", "네, 그러면 오픈 날짜는 삼월 십육일로 변경하는 걸로 확정하겠습니다."),
            Cue("지영", "그 정도면 부분 취소하고 중복 요청까지 큐에이에서 다시 볼 시간이 나옵니다."),
            Cue("한결", "저도 그 일정 기준으로 오류 화면하고 완료 화면을 다시 확인해둘게요. 아, 이건 디자인 확인 내용입니다."),
            Cue("민수", "좋아요. 일정 변경 안내는 제가 회의 뒤에 정리하겠습니다. 지금은 다음 안건으로 넘어갈게요."),
            Cue("지영", "네, 결제 기능 쪽 위험 요소는 방금 말씀드린 두 가지가 가장 큽니다."),
        ),
    ),
    Section(
        180.0,
        300.0,
        "PG사 선정",
        (
            Cue("민수", "자, 다음은 피지사 비교입니다. 제가 어제 표를 다시 정리해봤는데요."),
            Cue("지영", "아, 그 표 저도 보고 있었는데요. 수수료 차이가 생각보다 있더라고요.", overlap=1.15),
            Cue("민수", "맞습니다. 피지는 토스페이먼츠랑 나이스페이 두 군데 봤는데요."),
            Cue("지영", "수수료가 토스가 이 점 팔 퍼센트고 나이스가 좀 더 높았죠?"),
            Cue("한결", "네, 제가 본 자료도 그랬어요. 결제 화면 인지도는 두 곳 모두 크게 문제는 없어 보였고요."),
            Cue("민수", "네. 정산 주기도 토스가 십오일이라 더 짧고요. 토스페이먼츠로 갈까요?"),
            Cue("지영", "그렇게 하시죠."),
            Cue("한결", "저도 토스페이먼츠 쪽이면 괜찮습니다. 화면 연결할 때 필요한 로고 규정만 확인하면 될 것 같아요."),
            Cue("민수", "좋습니다. 그러면 나이스페이 대신 토스페이먼츠로 확정하겠습니다. 비용하고 정산 주기를 기준으로 한 결정입니다."),
            Cue("지영", "개발 문서는 토스 쪽이 예제가 조금 더 많아서 에이피아이 붙일 때도 편할 것 같아요."),
            Cue("민수", "토스 쪽에서 다음 주에 샌드박스 키 준다고 했어요. 그건 외부 일정 공유이고 저희 팀 할 일은 아닙니다."),
            Cue("한결", "키가 오기 전에는 실제 결제 대신 모의 응답으로 화면만 확인하면 되겠네요."),
            Cue("지영", "네, 이미 있는 테스트 응답으로 기본 흐름은 볼 수 있어요. 키가 오면 마지막 연결만 바꾸면 되고요."),
            Cue("민수", "계약서는 제가 금요일까지 검토해서 공유드릴게요."),
            Cue("지영", "네, 계약 조건에서 환불 수수료 항목도 한번 같이 봐주세요. 헷갈리는 문장이 하나 있었습니다."),
            Cue("한결", "브랜드 가이드 파일은 제가 참고만 해둘게요. 계약 검토 결과가 나오면 그때 화면을 맞추면 됩니다."),
            Cue("민수", "정리하면 피지사는 토스페이먼츠로 확정했고, 계약서 검토는 제가 금요일까지 하겠습니다."),
            Cue("지영", "네, 나이스페이는 비교 후보에서 제외하는 것으로 이해했습니다."),
            Cue("민수", "좋습니다. 그다음은 큐에이 계획을 보죠."),
        ),
    ),
    Section(
        300.0,
        390.0,
        "QA 계획",
        (
            Cue("민수", "오픈 날짜가 바뀌었으니 큐에이 범위도 다시 맞춰야 할 것 같습니다. 지금 작성된 시나리오가 어느 정도죠?"),
            Cue("지영", "기본 결제 성공하고 전액 취소까지는 초안이 있어요. 부분 취소, 네트워크 끊김, 중복 요청은 아직 더 써야 합니다."),
            Cue("한결", "결제 실패 뒤에 사용자가 돌아오는 화면도 한 케이스 넣어주세요. 안내 문구가 상황별로 조금 다릅니다."),
            Cue("민수", "지영 씨, 큐에이 시나리오는 삼월 오일까지 가능하실까요?"),
            Cue("지영", "네, 삼월 오일까지 정리해서 올릴게요."),
            Cue("민수", "감사합니다. 승인, 취소, 실패, 재시도 네 묶음이 구분되면 검토하기 편할 것 같아요."),
            Cue("지영", "네. 특히 응답 지연은 에스엘에이 기준도 같이 보겠습니다. 장애 응답은 이십사 시간 안에 받아야 한다고 되어 있어요."),
            Cue("한결", "그 이십사 시간은 고객 문의 답변 시간이 아니라 피지사 장애 대응 기준인 거죠?"),
            Cue("지영", "맞아요. 고객 응대 시간이 아니라 기술 지원 에스엘에이입니다. 문서에서 구분해서 적어둘게요."),
            Cue("민수", "좋습니다. 에이피아이 오류 코드하고 사용자에게 보여주는 문구가 일대일로 연결되는지도 봐주세요."),
            Cue("한결", "오류 코드가 너무 많으면 대표 상황으로 묶을 수 있게 화면 문구 표를 만들어놨습니다. 링크는 회의 뒤에 공유할게요."),
            Cue("지영", "아 잠깐만요, 지금 문서를 열어보니 결제 수단 변경 케이스도 빠져 있네요. 그것도 시나리오에 포함하겠습니다."),
            Cue("민수", "좋아요. 다만 새로운 담당이나 기한을 더 만들지는 말고, 큐에이 시나리오 안에서 정리해주세요."),
            Cue("지영", "네, 제가 맡은 시나리오 안에 포함해서 삼월 오일까지 올리겠습니다."),
            Cue("민수", "좋습니다. 큐에이는 그렇게 정리하고, 이제 인프라 비용을 볼게요."),
        ),
    ),
    Section(
        390.0,
        480.0,
        "인프라 비용",
        (
            Cue("민수", "비용 얘기는 숫자가 좀 많아서 천천히 보겠습니다. 지난달 청구서 기준으로 말씀드릴게요."),
            Cue("한결", "아, 네. 제가 비용 표를 지금 열어볼게요. 잠깐만요.", overlap=0.95),
            Cue("지영", "저도 열었습니다. 데이터베이스보다 로그 저장 쪽이 지난달에 많이 늘었네요."),
            Cue("민수", "네. 전체가 예상보다 올라서 항목별 원인을 먼저 나눠볼 필요가 있습니다."),
            Cue("한결", "컴퓨트, 데이터베이스, 저장소, 전송 비용으로 보면 저장소 증가 폭이 가장 큽니다."),
            Cue("민수", "한결 씨, 서버 비용 자료 좀 정리해주실 수 있어요? 지금 월 사백육십만 원 나가고 있는데 항목별로 좀 보고 싶어서요."),
            Cue("한결", "네, 정리해볼게요."),
            Cue("지영", "비용이 오른 건 새 로그 보관 기간도 영향이 있을 거예요. 일주일에서 한 달로 늘린 뒤에 아직 정리를 안 했거든요."),
            Cue("한결", "항목을 나눌 때 고정 비용하고 사용량 비용도 구분해보겠습니다. 그래야 다음 달 비교가 쉬울 것 같아요."),
            Cue("민수", "좋습니다. 지금은 원인을 먼저 보는 게 맞겠네요. 서버를 증설할지는 트래픽 좀 더 보고 결정하시죠."),
            Cue("지영", "네, 다음 달에 다시 얘기해요."),
            Cue("한결", "현재 수치만으로는 증설이 필요한지 판단하기 애매해요. 피크 시간 자료가 더 있어야 합니다."),
            Cue("민수", "네, 서버를 늘린다거나 안 늘린다는 결론은 지금 내리지 않겠습니다."),
            Cue("지영", "이번 주 데이터에는 행사 트래픽이 섞여 있으니 평소 수치하고 나눠서 봐야 할 것 같아요."),
            Cue("민수", "좋아요. 비용 안건은 여기까지 보고 모니터링 상태로 넘어가겠습니다.", gap_after=4.8),
        ),
    ),
    Section(
        480.0,
        540.0,
        "모니터링",
        (
            Cue("민수", "모니터링 화면은 어제 아침에 잠깐 봤는데, 대시보드 숫자 자체는 들어오고 있더라고요."),
            Cue("지영", "아 그리고 그라파나 알림이 지난주부터 안 오는 것 같던데, 이거 누가 한번 봐야 될 것 같아요."),
            Cue("민수", "아 그래요? 확인이 필요하겠네요."),
            Cue("한결", "저는 대시보드만 보고 있어서 알림이 끊긴 건 몰랐어요. 그래프 데이터는 계속 쌓이고 있습니다."),
            Cue("지영", "슬랙 채널에서 마지막 알림이 지난주 화요일이었어요. 그 뒤로 오류가 있었는데도 메시지가 없더라고요."),
            Cue("민수", "음, 알림 설정이나 연결 상태 문제일 수 있겠네요. 우선 현상은 회의 기록에 남겨주세요."),
            Cue("한결", "그라파나 대시보드 주소는 그대로고, 패널도 정상입니다. 알림 경로만 따로 확인하면 될 것 같아요."),
            Cue("지영", "네. 심각도 높은 오류가 한 번 있었는데 조용해서 발견이 늦었습니다. 원인은 아직 모르겠어요."),
            Cue("민수", "알겠습니다. 이건 확인이 필요하다는 내용까지만 적고, 다른 운영 얘기로 넘어가죠."),
        ),
    ),
    Section(
        540.0,
        600.0,
        "기타와 마무리",
        (
            Cue("민수", "마지막으로 운영 일정이나, 지금 안건에 없던 이야기 있으면 편하게 말씀해주세요."),
            Cue("한결", "저 그런데 주간 회의를 화요일로 옮기면 어떨까요? 월요일은 좀 정신없어서.", overlap=1.00),
            Cue("민수", "음, 그건 좀 생각해볼게요."),
            Cue("지영", "다음 주 참석자 일정도 봐야 하니까 오늘은 요일을 정하지 않고 넘어가도 될 것 같아요."),
            Cue("민수", "네. 아, 그리고 라따뚜이 결제 안내 문구는 오픈 날짜가 바뀐 뒤에 다시 한번 읽어보겠습니다."),
            Cue("지영", "나중에 시간 나면 결제 쪽 리팩터링도 한번 해야 되는데요."),
            Cue("민수", "그러게요."),
            Cue("한결", "지금 당장 정할 내용은 더 없는 것 같습니다. 오늘 나온 화면 변경만 제가 메모해둘게요."),
            Cue("민수", "그럼 결정된 건 오픈을 삼월 십육일로 미루는 것, 그리고 피지사를 토스페이먼츠로 정한 것 두 가지입니다."),
            Cue("지영", "네, 저는 큐에이 시나리오를 삼월 오일까지 올리는 걸로 이해했습니다."),
            Cue("민수", "맞습니다. 계약서는 제가 금요일까지 보고, 서버 비용 자료는 한결 씨가 정리하는 걸로 했습니다."),
            Cue("한결", "네, 확인했습니다."),
            Cue("민수", "좋습니다. 그럼 오늘 회의는 여기서 마칠게요. 모두 수고하셨습니다."),
            Cue("지영", "네, 수고하셨습니다."),
            Cue("한결", "수고하셨습니다."),
        ),
    ),
)


def run(args: list[str], *, quiet: bool = False) -> subprocess.CompletedProcess[str]:
    kwargs: dict[str, object] = {"check": True, "text": True}
    if quiet:
        kwargs.update(stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return subprocess.run(args, **kwargs)  # type: ignore[arg-type]


def duration(path: Path) -> float:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=duration",
            "-of",
            "json",
            str(path),
        ],
        quiet=True,
    )
    data = json.loads(result.stdout)
    return float(data["streams"][0]["duration"])


def synthesize(temp_dir: Path) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    cue_number = 0
    total_cues = sum(len(section.cues) for section in SECTIONS)
    for section_index, section in enumerate(SECTIONS, start=1):
        for cue in section.cues:
            cue_number += 1
            speaker = SPEAKERS[cue.speaker]
            output = temp_dir / f"cue-{cue_number:03d}.aiff"
            run(
                [
                    "say",
                    "-v",
                    speaker.voice,
                    "-r",
                    str(speaker.rate),
                    "-o",
                    str(output),
                    cue.text,
                ],
                quiet=True,
            )
            cue_duration = duration(output)
            if cue_duration <= 0.1:
                raise RuntimeError(f"음성 합성 실패: {cue_number} {cue.text}")
            records.append(
                {
                    "number": cue_number,
                    "section_index": section_index,
                    "section": section.topic,
                    "speaker_key": cue.speaker,
                    "speaker": speaker,
                    "text": cue.text,
                    "gap_after": cue.gap_after,
                    "overlap": cue.overlap,
                    "path": output,
                    "duration": cue_duration,
                }
            )
            if cue_number == 1 or cue_number % 10 == 0 or cue_number == total_cues:
                print(f"음성 합성 {cue_number}/{total_cues}", flush=True)
    return records


def schedule(records: list[dict[str, object]]) -> None:
    for section_index, section in enumerate(SECTIONS, start=1):
        group = [r for r in records if r["section_index"] == section_index]
        speech = sum(float(r["duration"]) for r in group)
        overlaps = sum(float(r["overlap"]) for r in group[1:])
        available = section.end - section.start - 1.0
        base_gap_total = sum(
            float(group[i]["gap_after"])
            for i in range(len(group) - 1)
            if float(group[i + 1]["overlap"]) == 0.0
        )
        # 짧은 구간에 대사가 많은 경우 문구를 삭제하지 않고 전체 발화만
        # 미세하게 빠르게 재생한다. 최소 휴지 길이는 원래 설계의 20%로 둔다.
        minimum_gaps = base_gap_total * 0.20
        usable_for_speech = available - minimum_gaps + overlaps
        playback_rate = max(1.0, speech / usable_for_speech)
        if playback_rate > 1.25:
            raise RuntimeError(
                f"'{section.topic}'에 필요한 속도 보정이 너무 큽니다: {playback_rate:.2f}배"
            )
        for record in group:
            record["playback_rate"] = playback_rate
            record["effective_duration"] = float(record["duration"]) / playback_rate
        effective_speech = sum(float(r["effective_duration"]) for r in group)
        needed_for_gaps = available - effective_speech + overlaps
        gap_scale = needed_for_gaps / base_gap_total if base_gap_total else 0.0
        previous_end = section.start + 0.5
        for index, record in enumerate(group):
            if index == 0:
                start = section.start + 0.5
            else:
                overlap = float(record["overlap"])
                if overlap > 0:
                    start = previous_end - overlap
                else:
                    previous = group[index - 1]
                    start = previous_end + float(previous["gap_after"]) * gap_scale
            record["start"] = start
            record["end"] = start + float(record["effective_duration"])
            previous_end = float(record["end"])


def write_timeline(records: list[dict[str, object]]) -> None:
    with TIMELINE.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, delimiter="\t")
        writer.writerow(("cue", "start", "end", "speaker", "section", "overlap", "text"))
        for record in records:
            speaker = record["speaker"]
            assert isinstance(speaker, Speaker)
            writer.writerow(
                (
                    record["number"],
                    f"{float(record['start']):.3f}",
                    f"{float(record['end']):.3f}",
                    speaker.name,
                    record["section"],
                    f"{float(record['overlap']):.2f}",
                    record["text"],
                )
            )


def pan_gains(pan: float) -> tuple[float, float]:
    left = math.sqrt((1.0 - pan) / 2.0) * math.sqrt(2.0)
    right = math.sqrt((1.0 + pan) / 2.0) * math.sqrt(2.0)
    return left, right


def mix(records: list[dict[str, object]], temp_dir: Path) -> None:
    command = ["ffmpeg", "-hide_banner", "-loglevel", "warning", "-y"]
    for record in records:
        command.extend(("-i", str(record["path"])))

    filter_lines: list[str] = []
    cue_labels: list[str] = []
    for index, record in enumerate(records):
        speaker = record["speaker"]
        assert isinstance(speaker, Speaker)
        left, right = pan_gains(speaker.pan)
        delay_ms = round(float(record["start"]) * 1000)
        label = f"cue{index}"
        filter_lines.append(
            f"[{index}:a]atempo={float(record['playback_rate']):.5f},"
            f"aresample=44100,highpass=f=90,lowpass=f=8500,"
            f"volume={speaker.volume:.3f},"
            f"pan=stereo|c0={left:.5f}*c0|c1={right:.5f}*c0,"
            f"adelay={delay_ms}|{delay_ms}[{label}]"
        )
        cue_labels.append(f"[{label}]")

    filter_lines.append(
        "".join(cue_labels)
        + f"amix=inputs={len(cue_labels)}:duration=longest:dropout_transition=0:normalize=0,"
        "acompressor=threshold=0.18:ratio=2.5:attack=12:release=180,"
        "aecho=0.8:0.75:38:0.055[voices]"
    )
    filter_lines.append(
        f"anoisesrc=color=brown:amplitude=0.0022:r=44100:d={TOTAL_DURATION},"
        "highpass=f=80,lowpass=f=3200,pan=stereo|c0=0.74*c0|c1=0.70*c0[room]"
    )
    filter_lines.append(
        f"sine=frequency=120:sample_rate=44100:duration={TOTAL_DURATION},"
        "volume=0.00018,pan=stereo|c0=c0|c1=0.92*c0[hum]"
    )
    filter_lines.append(
        "[voices][room][hum]amix=inputs=3:duration=longest:normalize=0,"
        "highpass=f=70,lowpass=f=10500,"
        "loudnorm=I=-18:LRA=8:TP=-1.5,"
        f"apad=whole_dur={TOTAL_DURATION},atrim=duration={TOTAL_DURATION}[out]"
    )

    graph = temp_dir / "filter-complex.txt"
    graph.write_text(";\n".join(filter_lines), encoding="utf-8")
    command.extend(
        (
            "-filter_complex_script",
            str(graph),
            "-map",
            "[out]",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-metadata",
            "title=라따뚜이 모의 회의 음성",
            "-metadata",
            "artist=김민수, 박지영, 이한결",
            "-metadata",
            "comment=MOCK-MEETING-SCRIPT.md Phase 0.5b 검증용 합성 회의",
            str(OUTPUT),
        )
    )
    print("회의 트랙 믹싱 중", flush=True)
    run(command)


def main() -> None:
    temp_dir = Path(tempfile.mkdtemp(prefix="ratatouille-meeting-", dir="/private/tmp"))
    try:
        records = synthesize(temp_dir)
        schedule(records)
        write_timeline(records)
        mix(records, temp_dir)
        print(f"완료: {OUTPUT}", flush=True)
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
