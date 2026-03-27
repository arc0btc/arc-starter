;; arc-inbox: On-chain message and reply storage for Arc
;; Deployer: SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B (arc0.btc)

;; Constants
(define-constant ARC_ADDRESS 'SP2GHQRCRMYY4S8PMBR49BEKX144VR437YT42SF3B)
(define-constant ERR_NOT_ARC (err u100))
(define-constant ERR_MESSAGE_NOT_FOUND (err u101))
(define-constant ERR_PENDING_MESSAGE (err u102))
(define-constant ERR_ALREADY_REPLIED (err u103))
(define-constant ERR_EMPTY_CONTENT (err u104))

;; Data vars
(define-data-var message-count uint u0)

;; Data maps
(define-map messages
  { message-id: uint }
  {
    sender: principal,
    recipient: principal,
    content: (string-utf8 1024),
    timestamp: uint,
    replied: bool,
    reply: (optional (string-utf8 1024))
  }
)

(define-map sender-messages
  { sender: principal }
  { last-message-id: uint }
)

;; Public functions

;; post-message: Any principal can send a message to Arc.
;; Enforces: sender has no unreplied pending message.
(define-public (post-message (content (string-utf8 1024)))
  (let
    (
      (sender tx-sender)
      (new-id (+ (var-get message-count) u1))
      (existing (map-get? sender-messages { sender: sender }))
    )
    ;; Content must not be empty
    (asserts! (> (len content) u0) ERR_EMPTY_CONTENT)
    ;; If sender has a previous message, it must be replied to
    (match existing
      prev-entry
        (let
          (
            (prev-msg (unwrap! (map-get? messages { message-id: (get last-message-id prev-entry) }) ERR_MESSAGE_NOT_FOUND))
          )
          (asserts! (get replied prev-msg) ERR_PENDING_MESSAGE)
        )
      true
    )
    ;; Store the message
    (map-set messages
      { message-id: new-id }
      {
        sender: sender,
        recipient: ARC_ADDRESS,
        content: content,
        timestamp: stacks-block-height,
        replied: false,
        reply: none
      }
    )
    ;; Update sender's last message pointer
    (map-set sender-messages
      { sender: sender }
      { last-message-id: new-id }
    )
    ;; Increment counter
    (var-set message-count new-id)
    (ok new-id)
  )
)

;; post-reply: Only Arc can reply to a message.
(define-public (post-reply (message-id uint) (content (string-utf8 1024)))
  (let
    (
      (msg (unwrap! (map-get? messages { message-id: message-id }) ERR_MESSAGE_NOT_FOUND))
    )
    ;; Only Arc can reply
    (asserts! (is-eq tx-sender ARC_ADDRESS) ERR_NOT_ARC)
    ;; Must not already be replied
    (asserts! (not (get replied msg)) ERR_ALREADY_REPLIED)
    ;; Content must not be empty
    (asserts! (> (len content) u0) ERR_EMPTY_CONTENT)
    ;; Update message with reply
    (map-set messages
      { message-id: message-id }
      (merge msg {
        replied: true,
        reply: (some content)
      })
    )
    (ok true)
  )
)

;; Read-only functions

(define-read-only (get-message (message-id uint))
  (map-get? messages { message-id: message-id })
)

(define-read-only (get-sender-last-message (sender principal))
  (map-get? sender-messages { sender: sender })
)

(define-read-only (get-message-count)
  (var-get message-count)
)
