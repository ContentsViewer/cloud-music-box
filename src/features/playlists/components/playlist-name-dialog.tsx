"use client"

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from "@mui/material"
import { useEffect, useState } from "react"

interface PlaylistNameDialogProps {
  open: boolean
  title: string
  description?: string
  initialName: string
  confirmLabel: string
  onClose: () => void
  onSubmit: (name: string) => void
}

/** Naming is the user's job — nothing here ever invents a name on its own. */
export function PlaylistNameDialog({
  open,
  title,
  description,
  initialName,
  confirmLabel,
  onClose,
  onSubmit,
}: PlaylistNameDialogProps) {
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const trimmed = name.trim()
  const submit = () => {
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {description ? (
          <DialogContentText sx={{ mb: 2 }}>{description}</DialogContentText>
        ) : null}
        <TextField
          autoFocus
          fullWidth
          label="Name"
          value={name}
          onChange={event => setName(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault()
              submit()
            }
          }}
          sx={{ mt: 1 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={submit} disabled={!trimmed}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
