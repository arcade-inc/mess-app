```
Parent ──places──▶ Order ──contains──▶ OrderItem(course, student_slot)
                                            │
                                   generates ▼
                                      Enrollment (status: PENDING)
                                            │
                                     has one ▼
                                    Invitation (token, expires_at, used_at)
                                            │ redeemed by
                                            ▼
                                   Student (account) ──▶ Enrollment ACTIVE
```

