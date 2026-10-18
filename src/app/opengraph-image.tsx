import { ImageResponse } from "next/og";

export const alt =
  "AI Reliability Copilot: evidence-first investigation and incident response for SRE teams";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          padding: "58px 64px",
          color: "#f4f4f5",
          background:
            "linear-gradient(135deg, #17152c 0%, #0b0b10 55%, #101d21 100%)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 8,
            display: "flex",
            background: "linear-gradient(90deg, #7668ff, #45d6ad)",
          }}
        />
        <div
          style={{
            width: 650,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            paddingRight: 36,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              padding: "9px 14px",
              border: "1px solid #48416f",
              borderRadius: 999,
              color: "#c4bcff",
              fontSize: 17,
              letterSpacing: 1,
            }}
          >
            OPEN-SOURCE SRE TOOLKIT
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginTop: 26,
              fontSize: 58,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: -2,
            }}
          >
            <span>AI Reliability</span>
            <span>Copilot</span>
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 22,
              maxWidth: 560,
              color: "#c4c4ce",
              fontSize: 24,
              lineHeight: 1.4,
            }}
          >
            Investigate incidents with evidence. Coordinate response with
            confidence.
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 35,
              color: "#8c8c9b",
              fontSize: 17,
            }}
          >
            ai-reliability-copilot.vercel.app
          </div>
        </div>

        <div
          style={{
            width: 420,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: "100%",
              padding: 25,
              border: "1px solid #33333d",
              borderRadius: 22,
              background: "rgba(24, 24, 31, 0.92)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                color: "#ededf1",
                fontSize: 20,
                fontWeight: 600,
              }}
            >
              Incident response
              <span
                style={{
                  display: "flex",
                  padding: "6px 10px",
                  borderRadius: 8,
                  color: "#ffbd73",
                  background: "#3a2b20",
                  fontSize: 15,
                }}
              >
                SEV1
              </span>
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 23,
                paddingTop: 18,
                borderTop: "1px solid #34343e",
                color: "#a9a9b5",
                fontSize: 16,
              }}
            >
              ROOT-CAUSE HYPOTHESES
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 10,
                color: "#f1f1f5",
                fontSize: 20,
              }}
            >
              Database connection pool exhausted
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                marginTop: 13,
                color: "#56d7ae",
                fontSize: 15,
              }}
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  marginRight: 9,
                  borderRadius: "50%",
                  background: "#56d7ae",
                }}
              />
              Supported by 3 evidence references
            </div>
            <div
              style={{
                display: "flex",
                marginTop: 23,
                padding: 14,
                borderRadius: 12,
                color: "#d8d4ff",
                background: "#27243e",
                fontSize: 16,
              }}
            >
              Mitigation plan · rollback included
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
