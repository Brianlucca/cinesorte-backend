const { sendMail, hasSmtpConfig } = require("./transport");
const { formatBahiaDateTime } = require("./utils");
const {
  buildSupportInboxTicketCreatedEmail: createSupportInboxTicketCreatedEmail,
  buildSupportInboxThreadStartEmail: createSupportInboxThreadStartEmail,
  buildSupportInboxReplyMirrorEmail: createSupportInboxReplyMirrorEmail,
  buildSupportInboxClosedMirrorEmail: createSupportInboxClosedMirrorEmail,
  buildSupportTicketClosedEmail: createSupportTicketClosedEmail,
  buildSupportTicketReceivedEmail: createSupportTicketReceivedEmail,
  buildSupportTicketReplyEmail: createSupportTicketReplyEmail,
} = require("./templates/support");
const {
  buildAccountNoticeEmail: createAccountNoticeEmail,
  buildAccountDeletionRequestEmail: createAccountDeletionRequestEmail,
  buildLoginAlertEmail: createLoginAlertEmail,
  buildPasswordResetEmail: createPasswordResetEmail,
  buildVerificationEmail: createVerificationEmail,
  buildWelcomeEmail: createWelcomeEmail,
} = require("./templates/account");
const {
  buildAccountDeletionEmail: createAccountDeletionEmail,
  buildCommentReplyEmail: createCommentReplyEmail,
  buildFollowNotificationEmail: createFollowNotificationEmail,
  buildMentionNotificationEmail: createMentionNotificationEmail,
  buildReviewCommentEmail: createReviewCommentEmail,
} = require("./templates/engagement");

const sendSupportTicketReceivedEmail = (payload) => sendMail(createSupportTicketReceivedEmail(payload));
const sendSupportInboxTicketCreatedEmail = (payload) => sendMail(createSupportInboxTicketCreatedEmail(payload));
const sendSupportInboxThreadStartEmail = (payload) => sendMail(createSupportInboxThreadStartEmail(payload));
const sendSupportInboxReplyMirrorEmail = (payload) => sendMail(createSupportInboxReplyMirrorEmail(payload));
const sendSupportInboxClosedMirrorEmail = (payload) => sendMail(createSupportInboxClosedMirrorEmail(payload));
const sendSupportTicketReplyEmail = (payload) => sendMail(createSupportTicketReplyEmail(payload));
const sendSupportTicketClosedEmail = (payload) => sendMail(createSupportTicketClosedEmail(payload));
const sendWelcomeEmail = (payload) => sendMail(createWelcomeEmail(payload));
const sendAccountNoticeEmail = (payload) => sendMail(createAccountNoticeEmail(payload));
const sendActionConfirmationEmail = (payload) => sendMail(createAccountNoticeEmail(payload));
const sendAccountDeletionRequestEmail = (payload) => sendMail(createAccountDeletionRequestEmail(payload));
const sendLoginAlertEmail = (payload) => sendMail(createLoginAlertEmail(payload));
const sendVerificationEmail = (payload) => sendMail(createVerificationEmail(payload));
const sendPasswordResetEmail = (payload) => sendMail(createPasswordResetEmail(payload));
const sendFollowNotificationEmail = (payload) => sendMail(createFollowNotificationEmail(payload));
const sendMentionNotificationEmail = (payload) => sendMail(createMentionNotificationEmail(payload));
const sendReviewCommentEmail = (payload) => sendMail(createReviewCommentEmail(payload));
const sendCommentReplyEmail = (payload) => sendMail(createCommentReplyEmail(payload));
const sendAccountDeletionEmail = (payload) => sendMail(createAccountDeletionEmail(payload));

module.exports = {
  hasSmtpConfig,
  formatBahiaDateTime,
  sendSupportTicketReceivedEmail,
  sendSupportInboxTicketCreatedEmail,
  sendSupportInboxThreadStartEmail,
  sendSupportInboxReplyMirrorEmail,
  sendSupportInboxClosedMirrorEmail,
  sendSupportTicketReplyEmail,
  sendSupportTicketClosedEmail,
  sendWelcomeEmail,
  sendAccountNoticeEmail,
  sendActionConfirmationEmail,
  sendAccountDeletionRequestEmail,
  sendLoginAlertEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendFollowNotificationEmail,
  sendMentionNotificationEmail,
  sendReviewCommentEmail,
  sendCommentReplyEmail,
  sendAccountDeletionEmail,
};
