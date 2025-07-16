/****************************************************************
* Author: Andrew Hatton                                         *
* Description: Used to send an email with a generated           *
*              calendar .ics file                               *
****************************************************************/
var myTenant = HeatContext.TenantId;
var tenantId = HeatContext.TenantId;
var StartDate = "$(ScheduledStartDate)";
var EndDate = "$(ScheduledEndDate)";
var Title = "$(Subject)";
var Description = "$(Description)";
var Location = "Office";
var OrganizerEmail= '$(GetGlobal("ListenerEmailAddress"))';
var Owner = "$(OwnerFullName)";
var OwnerEmail = "$(OwnerEmail)";
var APIKEY = "{Your-Api-Key}";
var sRECID = "$(RecId)";
 
 
function createICS(meetingDetails) {
  // Extract meeting details from the input object
  var title = meetingDetails.title;
  var description = meetingDetails.description;
  var location = meetingDetails.location;
  var startDate = meetingDetails.startDate;
  var endDate = meetingDetails.endDate;
  var organizerEmail = meetingDetails.organizerEmail;
  var attendees = meetingDetails.attendees;
 
  // Helper function to format dates (YYYYMMDDTHHMMSSZ for iCalendar)
  function formatDate(date) {
    var yyyy = date.getUTCFullYear();
    var mm = ('0' + (date.getUTCMonth() + 1)).slice(-2); // Month is zero-based
    var dd = ('0' + date.getUTCDate()).slice(-2);
    var hh = ('0' + date.getUTCHours()).slice(-2);
    var min = ('0' + date.getUTCMinutes()).slice(-2);
    var ss = ('0' + date.getUTCSeconds()).slice(-2);
    return yyyy + mm + dd + 'T' + hh + min + ss + 'Z';
  }
 
  // Format dates
  var formattedStartDate = formatDate(startDate);
  var formattedEndDate = formatDate(endDate);
  var formattedTimestamp = formatDate(new Date()); // Current timestamp
 
  // Build the ICS content using string concatenation
  var icsString = "BEGIN:VCALENDAR\n" +
                  "VERSION:2.0\n" +
                  "PRODID:-//ISM//CHANGE//EN\n" +
                  "CALSCALE:GREGORIAN\n" +
                  "METHOD:REQUEST\n" +
                  "BEGIN:VEVENT\n" +
                  "UID:" + Date.now() + OrganizerEmail + "\n" +
                  "DTSTAMP:" + formattedTimestamp + "\n" +
                  "DTSTART:" + formattedStartDate + "\n" +
                  "DTEND:" + formattedEndDate + "\n" +
                  "SUMMARY:" + title + "\n" +
                  "DESCRIPTION:" + description + "\n" +
                  "LOCATION:" + location + "\n" +
                  "ORGANIZER;CN=Organizer:MAILTO:" + organizerEmail + "\n";
 
  // Add attendees dynamically
  if (attendees && attendees.length) {
    for (var i = 0; i < attendees.length; i++) {
      var attendee = attendees[i];
      icsString += "ATTENDEE;CN=" + attendee.name + ";RSVP=TRUE:MAILTO:" + attendee.email + "\n";
    }
  }
 
  // End the calendar event
  icsString += "STATUS:CONFIRMED\n" +
               "TRANSP:OPAQUE\n" +
               "END:VEVENT\n" +
               "END:VCALENDAR";
 
  return icsString;
}
 
  
 
var att =  [
    { name: Owner , email: OwnerEmail }
  ];
 
 
const meetingDetails = {
  title: Title,
  description: Description,
  location: Location,
  startDate: new Date(StartDate.toString()), // Start date in UTC
  endDate: new Date(EndDate.toString()),   // End date in UTC
  organizerEmail: OrganizerEmail,
  attendees: att
};
 
const icsContent = createICS(meetingDetails);
console.log("ICS File Content:");
console.log(icsContent);
 
 
//Attachment Stuff
var commandData = {
		ObjectID : sRECID,
		ObjectType : "Change#",
		fileName : "meeting.ics",
		fileData : icsContent
	};
/////////////////////////
function generateUUID() {
    return 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0,
            v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

const math1 = Math.random().toString(36).substr(2, 9);
const boundary = '----MyCustomBoundary'+math1;
const delimiter = '--' + boundary;
const closeDelimiter = '--'+ boundary + '--';
let sFileName = "meeting";
// Construct the multipart body
const body = [
    delimiter,
    'Content-Disposition: form-data; name="ObjectID"',
    '',
    sRECID,
    delimiter,
    'Content-Disposition: form-data; name="ObjectType"',
    '',
    "Change#",
    delimiter,
    'Content-Disposition: form-data; name="files"; filename="' +  sFileName +  ".ics" + '"',
    'Content-Type: text/plain',
    '',
    icsContent,
    closeDelimiter,
    ''
].join('\r\n');
 
/////////////////////////
let thisHeader = {
    Headers:  {
            "SkipServerCertificateValidation": true,
            "AllowAutoRedirect": false,
            "Authorization": "rest_api_key=" + APIKEY,
            "Content-Type": "multipart/form-data; boundary=" + boundary
        }
};
 
//Attach it
sAttachEnd = "https://" + myTenant + "/api/rest/Attachment"
let rIns = ExecuteWebRequest("POST", sAttachEnd, body, thisHeader);
