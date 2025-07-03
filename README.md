# 📥 Incoming Emails Processor Lambda

An AWS Lambda function that processes **incoming emails** via **Amazon SES** and **S3**, extracts content and metadata using `mailparser`, and can trigger downstream workflows.

Useful for:
- Contact forms
- Support ticket systems
- Auto-responders
- Email-driven workflows

---

## 🛠️ How It Works

1. **Amazon SES** receives an incoming email.
2. **SES** stores the email content in an **S3 bucket**.
3. **S3** triggers this **Lambda** function with the email object metadata.
4. **Lambda** fetches and parses the raw email using [`mailparser`](https://nodemailer.com/extras/mailparser/).
5. Parsed email data is processed or forwarded based on your logic.

---

## 📁 Project Structure

```

.
├── src/
│   └── index.js         # Main Lambda function handler
├── tests/
│   └── index.test.js    # Unit tests for Lambda logic
├── package.json         # Project metadata and dependencies
└── README.md            # Documentation

````

---

## 🧪 Example Use Case

### Sample Raw Email Parsed Output

```json
{
  "from": "user@example.com",
  "subject": "Support needed",
  "text": "Hi there, I need help with...",
  "html": "<p>Hi there, I need help with...</p>",
  "attachments": []
}
````

---

## ⚙️ Environment Variables

| Variable       | Description                                                 |
| -------------- | ----------------------------------------------------------- |
| `AWS_REGION`   | AWS region (e.g. `us-east-1`)                               |
| `TARGET_EMAIL` | (Optional) Filter: process only emails sent to this address |

You can add more variables to control routing, notification, or data transformation.

---

## 🧰 Dependencies

* [`@aws-sdk/client-s3`](https://www.npmjs.com/package/@aws-sdk/client-s3) — for downloading email files
* [`mailparser`](https://www.npmjs.com/package/mailparser) — for parsing raw email content
* [`@aws-sdk/client-ses`](https://www.npmjs.com/package/@aws-sdk/client-ses) — optional, for replying or other SES actions

---

## 🚀 Deployment

You can deploy this Lambda using AWS Console, AWS CLI, or tools like Serverless Framework.

### Deploy with AWS CLI

```bash
zip function.zip src/index.js node_modules/ -r
aws lambda create-function \
  --function-name incoming-emails-processor \
  --runtime nodejs18.x \
  --handler src/index.handler \
  --zip-file fileb://function.zip \
  --role arn:aws:iam::<your-account-id>:role/<your-lambda-role>
```

Make sure your Lambda has permissions to read from S3 and write logs to CloudWatch.

---

## 🧪 Testing

Install dependencies and run:

```bash
npm install
npm test
```

Tests are located in the `tests/` folder and use [Jest](https://jestjs.io/).

---

## 📝 Notes

* Ensure your SES is configured to deliver incoming emails to the correct S3 bucket.
* You must verify your domain in SES and move out of the sandbox to handle production traffic.

---

## 📄 License

MIT License — see [LICENSE](./LICENSE) for details.

---

## 🙌 Contributions

Feel free to fork this repo, suggest improvements, or open pull requests.

---

## 👤 Author

Created by [@hkaab](https://github.com/hkaab)

```

---

Let me know if you also want:
- A sample parsed email output file (`email.json`)
- Code snippet for forwarding parsed emails
- A `serverless.yml` for automated deployment

I'd be happy to include those as well.
```
