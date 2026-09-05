# Mobile Messages

`MessagingContext` loads and updates message state through authenticated APIs;
`screens/MessagesScreen` renders conversations and send actions. Backend messaging
resolves number ownership and stores events. No message body should enter logs.
Test no assigned SMS number, send failure, refresh, logout and account switch.
Run mobile typecheck; live delivery requires a configured SMS-capable number.
