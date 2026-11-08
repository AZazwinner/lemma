
import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from db.core.auth.crud import get_authuser_by_id
from db.modules.docs.crud import create_document, create_document_copy, create_documentshare, delete_documentshare, get_document_by_id, get_document_version_by_id, get_document_versions, get_documentshare_by_ids, get_documentshares_by_id, get_documentshares_by_user_id, get_trashed_docs_by_owner_id, restore_document, restore_document_from_snapshot, soft_delete_document, update_document__title_text, delete_document, update_documentshare_with_share
from db.modules.docs.schemas import DocShareListingResponse, DocumentResponse, DocumentUpdate, DocumentShareResponse, DocumentShareResponseExpanded
from db.modules.docs.models import DocumentShare
from db.modules.users.crud import get_user_by_id


def create_blank_document(owner_id: int, db: Session):
    """A new document: one empty block, titled by the model's default ("Untitled")."""
    return create_document(owner_id, db)


def update_doc_text__check_permissions(
        doc_id: int,
        user_id: int,
        update_data: DocumentUpdate,
        db: Session,
):
    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False

    if not user_can_write_document(doc_id, user_id, db):
        return False
    
    update_document__title_text(doc, db, **update_data.model_dump())
    return True
    

def duplicate_doc__check_permissions(
        doc_id: int,
        user_id: int,
        db: Session,
):
    """Copies `document_blocks` only; the new doc's Y.Doc lazily backfills from those on first open."""
    if not user_can_read_document(doc_id, user_id, db):
        return None

    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return None

    return create_document_copy(
        owner_id=user_id,
        title=f"Copy of {doc.title}",
        blocks=doc.blocks,
        db=db,
    )


def delete_doc__check_permissions(
        doc_id: int,
        user_id: int,
        db: Session,
):
    """Soft-deletes (moves to trash) rather than removing the row."""
    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False

    if doc.owner_id != user_id:
        return False

    soft_delete_document(doc, db)
    return True


TRASH_RETENTION_DAYS = 30

def get_trash__check_permissions(
        owner_id: int,
        db: Session,
):
    """Lists the owner's trashed docs, purging anything past TRASH_RETENTION_DAYS first."""
    cutoff = datetime.utcnow() - timedelta(days=TRASH_RETENTION_DAYS)
    trashed = get_trashed_docs_by_owner_id(owner_id, db)

    kept = []
    for doc in trashed:
        if doc.deleted_at is not None and doc.deleted_at < cutoff:
            delete_document(doc, db)
        else:
            kept.append(doc)
    return kept

def restore_doc__check_permissions(
        doc_id: int,
        user_id: int,
        db: Session,
):
    doc = get_document_by_id(doc_id, db, include_deleted=True)
    if doc is None or doc.deleted_at is None:
        return False

    if doc.owner_id != user_id:
        return False

    restore_document(doc, db)
    return True

def get_document_versions__check_permissions(
        doc_id: int,
        user_id: int,
        db: Session,
):
    if not user_can_read_document(doc_id, user_id, db):
        return None
    return get_document_versions(doc_id, db)

def restore_document_version__check_permissions(
        doc_id: int,
        version_id: int,
        user_id: int,
        db: Session,
) -> tuple[bool, str | None]:
    """Restoring is blocked while anyone currently has the doc open, since a live session's periodic flush would overwrite it."""
    from db.coordination import clear_document_stream, is_document_live_elsewhere
    from db.modules.liveshare.ydoc_room import registry as yroom_registry

    if not user_can_write_document(doc_id, user_id, db):
        return False, "You don't have permission to edit this document."

    version = get_document_version_by_id(version_id, db)
    if version is None or version.doc_id != doc_id:
        return False, "Version not found."

    if doc_id in yroom_registry.rooms or is_document_live_elsewhere(doc_id):
        return False, "Close this document everywhere it's currently open, then try restoring again."

    blocks = json.loads(version.blocks_json)
    restore_document_from_snapshot(doc_id, blocks, db)
    clear_document_stream(doc_id)
    return True, None

def permanently_delete_doc__check_permissions(
        doc_id: int,
        user_id: int,
        db: Session,
):
    """Only reachable from the trash view; a live doc must be soft-deleted first."""
    doc = get_document_by_id(doc_id, db, include_deleted=True)
    if doc is None or doc.deleted_at is None:
        return False

    if doc.owner_id != user_id:
        return False

    delete_document(doc, db)
    return True
    


def user_can_write_document(
        doc_id: int,
        user_id: int,
        db: Session
):
    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False
    
    if doc.owner_id == user_id:
        return True
    
    share = get_documentshare_by_ids(doc_id, user_id, db)
    if not share:
        return False
    
    return share.permission == "write"

def user_can_read_document(
        doc_id: int,
        user_id: int,
        db: Session
):
    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False
    
    if doc.owner_id == user_id:
        return True
    
    share = get_documentshare_by_ids(doc_id, user_id, db)
    if not share:
        return False
    
    return True

def try_create_or_update_documentshare(
        doc_id: int,
        user_id: int,
        inviter_id: int,
        share_type: str,
        db: Session
) -> bool:
    if share_type not in ["read", "write"]:
        return False

    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False
    
    if doc.owner_id != inviter_id:
        inviter_share = get_documentshare_by_ids(doc_id, inviter_id, db)
        if inviter_share is None:
            return False
        if inviter_share.permission != "write":
            return False
    
    share = get_documentshare_by_ids(
        doc_id=doc_id,
        user_id=user_id,
        db=db
    )
    if share is None:
        create_documentshare(
            doc_id=doc_id,
            user_id=user_id,
            share_type=share_type,
            db=db
        )
    else:
        update_documentshare_with_share(
            share=share,
            share_type=share_type,
            db=db
        )
    return True

def try_get_documentshare(
        doc_id: int,
        user_id: int,
        db: Session
) -> DocumentShareResponse|None:
    if not user_can_read_document(doc_id, user_id, db):
        return None

    share = get_documentshare_by_ids(
        doc_id=doc_id,
        user_id=user_id,
        db=db
    )
    assert share is not None

    return DocumentShareResponse.model_validate(share)


def delete_docshare__check_permissions(
        doc_id: int,
        user_id: int,
        requester_id: int,
        db: Session,
) -> bool:
    """Requester must be the doc owner, a write-collaborator, or removing their own share."""
    doc = get_document_by_id(doc_id, db)
    if doc is None:
        return False

    is_owner = doc.owner_id == requester_id
    is_self = user_id == requester_id
    if not is_owner and not is_self and not user_can_write_document(doc_id, requester_id, db):
        return False

    share = get_documentshare_by_ids(doc_id, user_id, db)
    if share is None:
        return False

    delete_documentshare(doc_id, user_id, db)
    return True


def try_get_documentshares(
        doc_id: int,
        user_id: int,
        db: Session
) -> list[DocumentShareResponseExpanded]:
    if not user_can_read_document(doc_id, user_id, db):
        return []
    
    shares = get_documentshares_by_id(
        doc_id=doc_id,
        db=db
    )

    return [
        DocumentShareResponseExpanded(
            **DocumentShareResponse.model_validate(share).model_dump(),
            username=share.user.authuser.username
        )
        for share in shares
    ]


def get_viewable_documents(
        user_id: int,
        db: Session
):
    shares = get_documentshares_by_user_id(user_id, db)
    res = []
    for share in shares:
        doc = get_document_by_id(share.doc_id, db)
        if doc is None:
            continue
        user = get_user_by_id(doc.owner_id, db)
        if user is None:
            username = ""
        else:
            username = user.authuser.username
        res.append(DocShareListingResponse(
            id=share.doc_id,
            owner_id=doc.owner_id,
            owner_username=username,
            title=doc.title,
            blocks=doc.blocks,
            created_at=doc.created_at,
            updated_at=doc.updated_at,
            permission=share.permission
        ))

    return res


def view_document(
        doc_id: int,
        user_id: int,
        db: Session
):
    if not user_can_read_document(doc_id, user_id, db):
        return None
    
    return get_document_by_id(doc_id, db)

