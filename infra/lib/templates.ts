// API Gateway mapping templates (Velocity/VTL). API Gateway turns each request into a DynamoDB call
// and each DynamoDB response into the JSON the web app expects, with no Lambda in between.
//
// Request bodies are validated against the JSON schemas in shared/src/schemas.ts before these run,
// so ids, enums and numbers are known-safe. Free text is always passed through escapeJavaScript.
// The .replaceAll("\\'", "'") is the documented API Gateway idiom: escapeJavaScript escapes ' as \',
// which isn't valid JSON.
//
// Optional fields use #if("$!b.x" != ""): API Gateway hands JSON nulls to templates as "", and its #if
// treats "" as true. Unit-tested in infra/test/templates.test.ts.

/** Escaped string value of a VTL expression, safe inside JSON double quotes. */
const esc = (expr: string) => `$util.escapeJavaScript(${expr}).replaceAll("\\\\'", "'")`;

// ---------- quiz sessions ----------

export const sessionPutRequest = (table: string) => `#set($b = $input.path('$'))
{
  "TableName": "${table}",
  "Key": { "id": { "S": "$b.id" } },
  "UpdateExpression": "SET clientId = :c, answers = :a, pos = :p, updatedAt = :t, createdAt = if_not_exists(createdAt, :t)#if($b.completed), completedAt = if_not_exists(completedAt, :t)#end",
  "ConditionExpression": "attribute_not_exists(id) OR clientId = :c",
  "ExpressionAttributeValues": {
    ":c": { "S": "$b.clientId" },
    ":a": { "S": "${esc("$input.json('$.answers')")}" },
    ":p": { "N": "$b.pos" },
    ":t": { "N": "$context.requestTimeEpoch" }
  }
}`;

export const sessionPutOk = `{"ok": true}`;

/** DynamoDB 400s: a failed ownership condition becomes 403, anything else 400. */
export const sessionPutClientError = `#set($t = "$input.path('$.__type')")
#if($t.contains("ConditionalCheckFailed"))
#set($context.responseOverride.status = 403)
{"error": "This session belongs to someone else"}
#else
{"error": "Invalid request"}
#end`;

export const sessionsScanResponse = `#set($items = $input.path('$.Items'))
[#foreach($i in $items){"id": "$i.id.S", "clientId": "$i.clientId.S", "answers": $i.answers.S, "pos": $i.pos.N,"createdAt": $i.createdAt.N, "updatedAt": $i.updatedAt.N, "completedAt": #if($i.completedAt)$i.completedAt.N#{else}null#end}#if($foreach.hasNext), #end#end]`;

// ---------- feedback ----------

export const feedbackPostRequest = (table: string) => `#set($b = $input.path('$'))
{
  "TableName": "${table}",
  "Item": {
    "id": { "S": "$context.requestId" },
    "clientId": { "S": "$b.clientId" },
    #if("$!b.sessionId" != "")"sessionId": { "S": "$b.sessionId" },#end
    "rating": { "S": "$b.rating" },
    #if("$!b.useful" != "")"useful": { "S": "$b.useful" },#end
    "wrong": { "S": "${esc('$b.wrong')}" },
    "wish": { "S": "${esc('$b.wish')}" },
    "createdAt": { "N": "$context.requestTimeEpoch" }
  }
}`;

export const createdResponse = `{"id": "$context.requestId"}`;

export const feedbackScanResponse = `#set($items = $input.path('$.Items'))
[#foreach($i in $items){"id": "$i.id.S", "clientId": "$i.clientId.S", "sessionId": #if($i.sessionId)"$i.sessionId.S"#{else}null#end, "rating": "${esc('$i.rating.S')}", "useful": #if($i.useful)"$i.useful.S"#{else}null#end, "wrong": "${esc('$i.wrong.S')}", "wish": "${esc('$i.wish.S')}", "createdAt": $i.createdAt.N}#if($foreach.hasNext), #end#end]`;

// ---------- mentor requests ----------

export const mentorRequestPostRequest = (table: string) => `#set($b = $input.path('$'))
{
  "TableName": "${table}",
  "Item": {
    "id": { "S": "$context.requestId" },
    "clientId": { "S": "$b.clientId" },
    #if("$!b.sessionId" != "")"sessionId": { "S": "$b.sessionId" },#end
    "mentorId": { "S": "$b.mentorId" },
    #if("$!b.grade" != "")"grade": { "N": "$b.grade" },#end
    "message": { "S": "${esc('$b.message')}" },
    "parentEmail": { "S": "${esc('$b.parentEmail')}" },
    "status": { "S": "new" },
    "createdAt": { "N": "$context.requestTimeEpoch" },
    "updatedAt": { "N": "$context.requestTimeEpoch" }
  }
}`;

export const requestsScanResponse = `#set($items = $input.path('$.Items'))
[#foreach($i in $items){"id": "$i.id.S", "clientId": "$i.clientId.S", "sessionId": #if($i.sessionId)"$i.sessionId.S"#{else}null#end, "mentorId": "$i.mentorId.S", "grade": #if($i.grade)$i.grade.N#{else}null#end, "message": "${esc('$i.message.S')}", "parentEmail": "${esc('$i.parentEmail.S')}", "status": "$i.status.S", "createdAt": $i.createdAt.N, "updatedAt": $i.updatedAt.N}#if($foreach.hasNext), #end#end]`;

export const requestStatusRequest = (table: string) => `{
  "TableName": "${table}",
  "Key": { "id": { "S": "${esc("$input.params('id')")}" } },
  "UpdateExpression": "SET #s = :s, updatedAt = :t",
  "ConditionExpression": "attribute_exists(id)",
  "ExpressionAttributeNames": { "#s": "status" },
  "ExpressionAttributeValues": { ":s": { "S": "$input.path('$.status')" }, ":t": { "N": "$context.requestTimeEpoch" } }
}`;

export const requestStatusOk = `{"ok": true}`;

/** Updating a request that doesn't exist fails the condition: answer 404. */
export const requestStatusClientError = `#set($t = "$input.path('$.__type')")
#if($t.contains("ConditionalCheckFailed"))
#set($context.responseOverride.status = 404)
{"error": "Request not found"}
#else
{"error": "Invalid request"}
#end`;

// ---------- admin scans ----------

export const scanRequest = (table: string) => `{ "TableName": "${table}" }`;

export const serverError = `{"error": "Something went wrong"}`;
