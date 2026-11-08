from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from db.core.auth.schemas import AuthUserUpdate__Password
from db.core.auth.services import update_authuser__password
from db.modules.docs.crud import get_docs_by_owner_id, get_documentshares_by_id
from db.modules.docs.schemas import DocShareListingResponse, DocumentResponsePermission, DocumentShareResponseExpanded, DocumentResponse, DocumentUpdate
from db.modules.docs.services import create_blank_document, delete_docshare__check_permissions, duplicate_doc__check_permissions, get_document_versions__check_permissions, get_trash__check_permissions, get_viewable_documents, permanently_delete_doc__check_permissions, restore_doc__check_permissions, restore_document_version__check_permissions, try_create_or_update_documentshare, try_get_documentshares, update_doc_text__check_permissions, delete_doc__check_permissions, try_get_documentshare, user_can_write_document, view_document
from db.modules.users.crud import get_user_by_id
from db.modules.users.models import User
from db.modules.users.schemas import UserPublicResponse, UserPrivateResponse
from db.modules.users.services import get_current_user
from db.database import get_db

router = APIRouter()

MAX_TITLE_LENGTH = 255

class CreateDocData(BaseModel):
    # A new document is always blank and starts as "Untitled" (the writer renames it afterwards), so the title is not used.
    # It is still accepted, and still limited in length, so a client that sends one is checked as before.
    title: Optional[str] = Field("New document", max_length=MAX_TITLE_LENGTH)

class CreateDocResponse(BaseModel):
    doc_id: int

@router.post("/docs/new", response_model=CreateDocResponse)
def create_doc(
    data: CreateDocData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doc = create_blank_document(current_user.id, db)
    return {
        "doc_id": doc.id
    }

class DuplicateDocData(BaseModel):
    doc_id: int

class DuplicateDocResponse(BaseModel):
    doc_id: int

@router.post("/docs/duplicate", response_model=DuplicateDocResponse)
def duplicate_doc(
    data: DuplicateDocData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_doc = duplicate_doc__check_permissions(
        doc_id=data.doc_id,
        user_id=current_user.id,
        db=db,
    )
    if new_doc is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return {
        "doc_id": new_doc.id
    }

class DocsResponse(BaseModel):
    docs: list[DocumentResponse]

@router.get("/my-docs", response_model=DocsResponse)
def get_docs(
    own: bool = True,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if own:
        return {
            "docs": get_docs_by_owner_id(current_user.id, db)
        }
    return {
        "docs": []
    }

class DocsSharedResponse(BaseModel):
    docs: list[DocShareListingResponse]
    
@router.get("/shared-docs", response_model=DocsSharedResponse)
def get_shared_docs(
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {
        "docs": get_viewable_documents(current_user.id, db)
    }
    
@router.get("/docs/{doc_id}", response_model=DocumentResponsePermission|None)
def get_document(
    doc_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    doc = view_document(doc_id, current_user.id, db)
    if doc is None:
        return None
    
    if doc.owner_id == current_user.id:
        permission = "write"
    elif user_can_write_document(doc_id, current_user.id, db):
        permission = "write"
    else:
        permission = "read"
    
    return {
        **DocumentResponse.model_validate(doc).model_dump(),
        "permission": permission,
        "owner_username": doc.owner.authuser.username
    }

class SuccessResponse(BaseModel):
    success: bool

class UpdateDocData(BaseModel):
    doc_id: int
    title: Optional[str] = Field(None, max_length=MAX_TITLE_LENGTH)
    text: Optional[str|None]=None

@router.post("/update-doc", response_model=SuccessResponse)
def update_doc_text(
    data: UpdateDocData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    update_data = DocumentUpdate.model_validate({
        "text": data.text,
        "title": data.title,
    })
    success = update_doc_text__check_permissions(
        doc_id=data.doc_id,
        user_id=current_user.id,
        update_data=update_data,
        db=db
    )
    return {
        "success": success
    }

@router.delete("/doc", response_model=SuccessResponse)
def delete_doc(
    doc_id: int,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success = delete_doc__check_permissions(
        doc_id=doc_id,
        user_id=current_user.id,
        db=db
    )
    return {
        "success": success
    }

class TrashedDocResponse(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime

    model_config = {
        "from_attributes": True
    }

class TrashResponse(BaseModel):
    docs: list[TrashedDocResponse]

@router.get("/trash", response_model=TrashResponse)
def get_trash(
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return {
        "docs": get_trash__check_permissions(current_user.id, db)
    }

class DocIdData(BaseModel):
    doc_id: int

@router.post("/doc/restore", response_model=SuccessResponse)
def restore_doc(
    data: DocIdData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success = restore_doc__check_permissions(
        doc_id=data.doc_id,
        user_id=current_user.id,
        db=db
    )
    return {
        "success": success
    }

@router.delete("/doc/permanent", response_model=SuccessResponse)
def permanently_delete_doc(
    doc_id: int,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success = permanently_delete_doc__check_permissions(
        doc_id=doc_id,
        user_id=current_user.id,
        db=db
    )
    return {
        "success": success
    }



class DocumentVersionResponse(BaseModel):
    id: int
    created_at: datetime

    model_config = {
        "from_attributes": True
    }

class DocumentVersionsResponse(BaseModel):
    versions: list[DocumentVersionResponse]

@router.get("/doc/versions", response_model=DocumentVersionsResponse)
def get_doc_versions(
    doc_id: int,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    versions = get_document_versions__check_permissions(doc_id, current_user.id, db)
    if versions is None:
        raise HTTPException(status_code=403, detail="Not permitted")
    return {
        "versions": versions
    }

class RestoreVersionData(BaseModel):
    doc_id: int
    version_id: int

@router.post("/doc/versions/restore", response_model=SuccessResponse)
def restore_doc_version(
    data: RestoreVersionData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success, error = restore_document_version__check_permissions(
        doc_id=data.doc_id,
        version_id=data.version_id,
        user_id=current_user.id,
        db=db,
    )
    if not success:
        raise HTTPException(status_code=400, detail=error)
    return {
        "success": True
    }



class DocShareData(BaseModel):
    doc_id: int
    user_id: int
    share_type: str

    model_config = {
        "from_attributes": True
    }

@router.post("/doc-share", response_model=SuccessResponse)
def share_doc(
    data: DocShareData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success = try_create_or_update_documentshare(
        doc_id=data.doc_id,
        user_id=data.user_id,
        inviter_id=current_user.id,
        share_type=data.share_type,
        db=db
    )
    return {
        "success": success
    }

@router.get("/doc-shares", response_model=list[DocumentShareResponseExpanded])
def get_docshare(
    doc_id: int,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return try_get_documentshares(
        doc_id=doc_id,
        user_id=current_user.id,
        db=db
    )

class DocShareDeleteData(BaseModel):
    doc_id: int
    user_id: int

@router.delete("/doc-share", response_model=SuccessResponse)
def delete_docshare(
    data: DocShareDeleteData,
    current_user: UserPrivateResponse = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    success = delete_docshare__check_permissions(
        doc_id=data.doc_id,
        user_id=data.user_id,
        requester_id=current_user.id,
        db=db
    )
    return {
        "success": success
    }
