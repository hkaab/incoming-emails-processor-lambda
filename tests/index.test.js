// tests/index.test.js
import { handler } from "../src/index.js";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { simpleParser } from "mailparser";
import { Readable } from "stream";

// Mock AWS SDK and mailparser
jest.mock("@aws-sdk/client-s3");
jest.mock("mailparser");

describe("incoming-emails-processor-lambda", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should successfully parse an email and return subject", async () => {
    // Mocked email content
    const mockEmail = { subject: "Test Email Subject" };
    simpleParser.mockResolvedValue(mockEmail);

    // Mock S3 getObject stream
    const mockStream = Readable.from(["mock email content"]);
    S3Client.prototype.send = jest.fn().mockResolvedValue({
      Body: mockStream,
    });

    const event = {
      Records: [
        {
          s3: {
            bucket: { name: "test-bucket" },
            object: { key: "emails/test.eml" },
          },
        },
      ],
    };

    const result = await handler(event);

    expect(S3Client.prototype.send).toHaveBeenCalledWith(
      expect.any(GetObjectCommand)
    );
    expect(simpleParser).toHaveBeenCalled();
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ subject: "Test Email Subject" });
  });

  it("should return 500 on error", async () => {
    simpleParser.mockRejectedValue(new Error("Failed to parse"));
    S3Client.prototype.send = jest.fn().mockResolvedValue({
      Body: Readable.from(["bad data"]),
    });

    const event = {
      Records: [
        {
          s3: {
            bucket: { name: "test-bucket" },
            object: { key: "emails/broken.eml" },
          },
        },
      ],
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(500);
    expect(result.body).toBe("Failed to process email");
  });
});
