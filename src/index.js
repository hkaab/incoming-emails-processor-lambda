// AWS SDK for JavaScript v2
// This Lambda function connects to an IMAP email server, retrieves emails, parses them
// and saves them to an S3 bucket and a MySQL database.
// It uses the ImapFlow library for IMAP operations, mailparser for parsing emails,
// and the AWS SDK for JavaScript to interact with S3 and Parameter Store.
// The function is triggered by an event, which is expected to be an AWS Lambda 
// invocation event.
// The function retrieves email credentials and database connection details from AWS Systems Manager Parameter Store.

var mysql = require('mysql');

// ImapFlow is a library for handling IMAP email operations.
// It allows you to connect to an IMAP server, fetch emails, and manage mailboxes   
const { ImapFlow } = require('imapflow');

// mailparser is used to parse the email content and attachments
// It provides a simple interface to extract email details like subject, from, to, etc.
const simpleParser = require("mailparser").simpleParser;

const aws = require('aws-sdk');

aws.config.update({
  region: 'ap-southeast-2'
});

// The AWS Systems Manager (SSM) Parameter Store is used to securely store and retrieve configuration data
// such as database credentials and email server settings.
const parameterStore = new aws.SSM();

const getParam = param => {
  return new Promise((res, rej) => {
    parameterStore.getParameter({
      Name: param
    }, (err, data) => {
        if (err) {
          return rej(err);
        }
        return res(data);
    });
  });
};

// The AWS S3 service is used to store email attachments and parsed emails.
// It allows you to upload files to a specified bucket and manage them.
const s3 = new aws.S3();

// This function extracts the file extension from a given filename.
// It uses a regular expression to find the last dot in the filename and returns the substring after  that dot.
// If no dot is found, it returns undefined.
const getFileExtension = (filename) => {
    return (/[.]/.exec(filename)) ? /[^.]+$/.exec(filename)[0] : undefined;
};

// This function establishes a connection to a MySQL database using credentials stored in AWS Systems Manager Parameter Store.
// It retrieves the database name, endpoint, user, and password from the Parameter Store and returns a MySQL connection object.

const getMySqlConnection = async () => {
    const dbs_db = await getParam(`/mysql/dbs_db`);
    const dbs_endpoint = await getParam(`/mysql/dbs_endpoint`);
    const dbs_user = await getParam(`/mysql/dbs_user`);
    const dbs_password = await getParam(`/mysql/dbs_password`);
    return  mysql.createConnection({
        host: dbs_endpoint.Parameter.Value,
        user: dbs_user.Parameter.Value,
        password: dbs_password.Parameter.Value,
        database: dbs_db.Parameter.Value,
        timezone: 'utc',
        connectTimeout: 30000
    });
};
// This function retrieves the IMAP configuration for connecting to the email server.
// It fetches the email address and password from AWS Systems Manager Parameter Store and returns an object
const getImapConfig = async () => {
    // Retrieve email credentials from AWS Systems Manager Parameter Store
    // These credentials are used to connect to the IMAP email server.
    const journal_email = await getParam(`/email/journal_email`);
    const journal_email_pass = await getParam(`/email/journal_email_pass`);
    
    // Return the IMAP configuration object
    // This object contains the host, port, security settings, authentication details, and client information   
    // required to connect to the email server.
    // The host is set to the AWS WorkMail IMAP endpoint, and the port is set to 993 for secure IMAP connections.
    // The authentication details include the email address and password retrieved from the Parameter Store.
    return  {
    host: 'imap.mail.us-east-1.awsapps.com',
    port: 993,
    secure: true,
    tls: {
        rejectUnauthorized: false
    },
    auth: {
        user: journal_email.Parameter.Value,
        pass: journal_email_pass.Parameter.Value
    },
    clientInfo: {
        name: false,
        'support-url': false,
        vendor: false,
        date: false
    }};
   
};

// This is the main handler function for the AWS Lambda function.
// It connects to the IMAP email server, retrieves emails from the INBOX, parses them
// and saves them to an S3 bucket and a MySQL database.
// It uses the ImapFlow library to handle IMAP operations, mailparser to parse emails
// and the AWS SDK to interact with S3 and Parameter Store.
exports.handler = async (_) => {

  const imap_config = await getImapConfig();
  const client = new ImapFlow(imap_config);

  // Initialize the result object to indicate failure by default
  let result = {failed: true} ;

  // Connect to the IMAP server using the ImapFlow client
  // This establishes a connection to the email server using the provided configuration.
  // The connection is secure and uses the credentials retrieved from the Parameter Store.
  await client.connect();
  
  // Initialize variables to hold the email and original message
  // These variables will be used to store the parsed email and the original message content.
  var mail = undefined;
  var original = undefined;

  // Get a lock on the INBOX mailbox to ensure exclusive access while processing emails
  // This prevents other processes from modifying the mailbox while this function is running.   
  let lock = await client.getMailboxLock('INBOX');
  
  try {
      // Check the status of the INBOX mailbox to see if there are any messages
      // The status includes the number of messages in the mailbox.
      let status = await client.status('INBOX', {messages: true});
      if (status.messages > 0){
      // If there are messages in the INBOX, proceed to process them
      console.log(`Processing ${status.messages} messages in INBOX`);
      const con = await getMySqlConnection();
      const connected = await connect(con).then((r) => { return r; }, (err) => console.log(err));
      
      // If the connection to the MySQL database is successful, proceed to fetch and process emails
      // If the connection fails, log the error and set the result to indicate failure. 
      if (connected){
          
        const date = new Date();
        const month = date.getMonth() + 1;
        const year = date.getFullYear();

        // Define the S3 bucket where email attachments and parsed emails will be stored
        // The bucket name is retrieved from the environment variable EMAIL_BUCKET.
        const bucket = process.env.EMAIL_BUCKET;
        if (!bucket) {
            throw new Error('EMAIL_BUCKET environment variable is not set');
        }
        // Initialize an array to keep track of seen messages
        // This array will store the UIDs of messages that have been processed to avoid duplicates.
        const seen = [];

        // Fetch all messages from the INBOX mailbox
        // The fetch method retrieves messages with their source and UID, which are necessary for processing.
        for await (let message of client.fetch('1:*', { source:true,uid: true })) {
          
          mail = await simpleParser(message.source);
          
          original = await simpleParser(mail.attachments[0].content);   
          
        // Check if the email has already been processed by looking for its UID in the seen array
        // If the UID is not in the seen array, it means the email is new and
        // should be processed and saved to the database and S3 bucket.
        if (!seen.includes(message.uid)) {
          let folder = `inbound/${year}/${month}/${original.to.value[0].address.split('@')[0]}`;
          let eml = `${original.messageId.split("@")[0].slice(1)}.eml`;
          let key = `${folder}/${eml}`;
          
      
          // Upload the EML file to the S3 bucket
          // The EML file is created from the original message content and is stored in the specified folder structure.
          // The folder structure is based on the recipient's email address and the current year and month.
          // The key is the path where the EML file will be stored in the S3 bucket.
          // The content type is set to 'application/octet-stream' to indicate that it is a binary file.
          await putS3File(bucket,key,mail.attachments[0].content,"application/octet-stream");
          
          // Create an object to represent the EML file
          // This object contains the filename, filetype, original message identifier, and folder path.
          // It will be used to store the EML file in the S3 bucket and to save the email details in the database.
          // The filename is derived from the message ID and the folder structure is based on the recipient's email address.
          // The filetype is set to 'application/octet-stream' to indicate that it is a binary file.
          // The original message identifier is used to track the original email message.   
          const emlObj = {
              filename: eml,
              filetype: 'application/octet-stream',
              original: 'ORIGINAL_MESSAGE_'+ eml,
              folder: folder
          };

          let email = {
              from: original.from.value[0].address,
              to: original.to.value[0].address,
              subject: original.subject,
              body: original.textAsHtml,
              html: original.html,
              messageId: original.messageId,
              inReplyTo: original.inReplyTo
          };
          
          if (original.cc) {
              email = {...email,cc:original.cc.text};
          }

          if (original.bcc) {
            email = {...email,bcc:original.bcc.text};
          }

          // Create a folder structure in the S3 bucket based on the recipient's email address and the current year and month
          // The folder structure is used to organize the emails and attachments in a logical manner.
          const attachments = await Promise.all(original.attachments.map( async (a,i) => {
              
          let filename = Date.now().toString() + i + '.' + getFileExtension(a.filename);
           
          key = `${folder}/${filename}`;

          await putS3File(bucket,key,a.content,a.contentType);
            
            return {
              filename: filename,
              filetype: a.contentType,
              original: a.filename,
              folder: folder
            };
            
          }));
          
          attachments.push(emlObj);
          
          email.attachments = attachments;
            
          await save_email(con,JSON.stringify(email)).then((res) => { result = res; }, (err) => { console.log(err); });
          
          seen.push(message.uid);
          
            }
        } // end of for await loop

        // After processing each message, mark it as seen and move it to the Trash folder
        // This ensures that the message is not processed again in future runs of the function.
        if (seen.length > 0) {
            const s = seen.join();
            await client.messageFlagsAdd(s, ['\\Seen'],{uid: true});          
            await client.messageMove(s, 'Trash', {uid:true});
            await client.messageDelete(s, {uid:true});
        }

      // If all messages have been processed successfully, set the result to indicate success
      result = {success:true};
      console.log(`Processed ${seen.length} messages and saved to S3 and MySQL.`);
      // Close the MySQL connection after processing all messages
      con.end();
      con.destroy();
      
    } else {
        console.log('not connected');
        result = {success:false, error: 'Could not connect to MySQL database'};
        }
      } else {
        console.log('no messages');
        result = {success:false, error: 'No messages in INBOX'};
      } 
  } finally {
    // Release the lock on the INBOX mailbox
    // This allows other processes to access the mailbox after this function has completed.
    lock.release();
  }

  // Logout from the IMAP server
  // This closes the connection to the email server and cleans up any resources used by the ImapFlow client.
  await client.logout();

    // Return the result of the operation
    return {
    "statusCode": 200,
    "headers": {
    "Access-Control-Allow-Origin": "*"
    },
    "body": JSON.stringify(result)
    };
};

// This function connects to the MySQL database using the provided connection object.
// It returns a promise that resolves to true if the connection is successful, or false if it
// fails. The connection is established using the connect method of the MySQL connection object.
// If an error occurs during the connection, it is logged to the console and the promise is
// rejected with false.
// The connection timeout is set to 30 seconds to allow sufficient time for the connection to be    
// established before timing out.
// The function is asynchronous and uses the async/await syntax to handle the connection process.
async function connect(con) {
    return new Promise(function (resolve, reject) {
        con.connect(function (err) {
            if (err) {
                reject(false);
                return;
            }
            else resolve(true);
        });
    });
}
// This function saves the parsed email to the MySQL database using a stored procedure.
// It takes a MySQL connection object and the email data as parameters. 
// The email data is expected to be a JSON string that contains the email details such as from, to, subject, body, etc.
// The function prepares a SQL statement to call the stored procedure `sp_save_inbound_email`
// with the email data as a parameter. It uses the mysql.format method to safely format the SQL statement with the provided parameters.
// The function returns a promise that resolves with the result of the query or rejects with an error

async function save_email(con, email) {
    let params = [email];
    let sql = 'CALL sp_save_inbound_email(?)';
    sql = mysql.format(sql, params);
    return new Promise(function (resolve, reject) {
        con.query(sql, function (err, result) {
            if (err) {
                reject(err);
                return;
            }
            else resolve(result);
        });
    });
}

// This function uploads a file to an S3 bucket using the AWS SDK for JavaScript.
// It takes the bucket name, key (file path), data (file content), and content type as parameters.
// The function returns a promise that resolves with the result of the upload operation or rejects with an error.
async function putS3File(bucket, key,data,contentType) {
    return new Promise(function(resolve, reject) {
        s3.putObject(
            {
                Bucket: bucket,
                Key: key,
                Body: data,
                ContentType: contentType
            },
            function (err, data) {
                if (err) return reject(err);
                else return resolve(data);
            }
        );
    });
}   


