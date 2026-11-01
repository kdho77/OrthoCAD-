import numpy as np
from PIL import Image
import matplotlib; matplotlib.use("Agg"); import matplotlib.cm as cm
W,H=400,800
y,x=np.mgrid[0:H,0:W].astype(float)
def g(cx,cy,sx,sy,a=1): return a*np.exp(-(((x-cx)/sx)**2+((y-cy)/sy)**2)/2)
def ell(cx,cy,rx,ry): return ((x-cx)/rx)**2+((y-cy)/ry)**2<=1
# LEFT foot, viewed from above, toes up, medial on +x (right side of image)
m=ell(200,620,62,85)|ell(205,300,105,95)  # heel, forefoot
# lateral midfoot band (left side), medial arch cut-in on right
band=(y>330)&(y<600)&(x>120+ (y-330)*0.05)&(x<150+ (600-y)*0.0+20)
m|=ell(165,460,48,150)
# toes: hallux medial (right)
m|=ell(262,165,34,48)
for cx,cy in [(212,175),(178,188),(148,205),(122,228)]: m|=ell(cx,cy,15,20)
p=g(200,640,40,45,1.0)+g(262,300,26,22,.95)+g(220,290,22,20,.8)+g(180,295,22,20,.7)+g(145,310,22,20,.6)+g(262,165,22,28,.85)+g(165,460,25,80,.35)+0.15
p=np.clip(p,0,1)*m
rgb=(cm.jet(p)[...,:3]*255).astype(np.uint8); rgb[~m]=255
pad=np.full((H+160,W+160,3),255,np.uint8); pad[80:-80,80:-80]=rgb
Image.fromarray(pad).save("left_foot_pressure.png")
Image.fromarray(pad[:,::-1].copy()).save("right_foot_pressure.png")
